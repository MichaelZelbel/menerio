// Server-side bulk actions for the review queue.
//
// The client used to iterate every pending item in the browser and fire
// multiple DB round-trips per row. That froze the tab at 2k+ items.
//
// This function accepts one request per bulk action, immediately returns a
// job_id, and processes the entire queue in the background via
// EdgeRuntime.waitUntil. Progress is written to review_queue_bulk_jobs, which
// the client polls every couple of seconds.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { relationshipWriteDecision } from "../_shared/profile-integrity.ts";
import { adjudicateRelationship } from "../_shared/relationship-adjudicator.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { z } from "npm:zod@3.23.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;

const BodySchema = z.object({
  action: z.enum(["keep", "rollback", "never_again"]),
  scope: z.union([z.literal("all"), z.object({ ids: z.array(z.string().uuid()).min(1) })]).default("all"),
});

const PAGE = 500;

type ReviewRow = {
  id: string;
  user_id: string;
  suggestion_type: string;
  target_entity_id: string | null;
  target_entity_type: string | null;
  applied_at: string | null;
  source_note_id: string | null;
  suppression_key: string | null;
  extracted_value: string | null;
  title: string | null;
  payload: Record<string, unknown> | null;
  status: string;
};

async function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader) return json(401, { error: "missing_auth" });

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
  const anon = createClient(SUPABASE_URL, ANON, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: userData, error: userErr } = await anon.auth.getUser();
  if (userErr || !userData?.user) return json(401, { error: "invalid_auth" });
  const userId = userData.user.id;

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch (e: any) {
    return json(400, { error: "invalid_body", details: String(e?.message || e) });
  }

  // Create the job row up front so the client can start polling immediately.
  const { data: job, error: jobErr } = await admin
    .from("review_queue_bulk_jobs")
    .insert({
      user_id: userId,
      action: body.action,
      scope: body.scope === "all" ? "all" : "ids",
      status: "running",
      total: 0,
      done: 0,
      failed: 0,
    })
    .select("id")
    .single();
  if (jobErr || !job) return json(500, { error: "job_create_failed", details: jobErr?.message });

  EdgeRuntime.waitUntil(runJob(admin, userId, job.id, body).catch(async (err) => {
    console.error("review-queue-bulk job failed", job.id, err);
    await admin.from("review_queue_bulk_jobs").update({
      status: "error",
      finished_at: new Date().toISOString(),
      last_error: String(err?.message || err),
    }).eq("id", job.id);
  }));

  return json(202, { job_id: job.id });
});

async function runJob(
  db: SupabaseClient,
  userId: string,
  jobId: string,
  body: z.infer<typeof BodySchema>,
) {
  // 1) Fetch target IDs for this job (review queue + wiki revisions).
  const scopedIds = body.scope === "all" ? null : body.scope.ids;

  // Review queue rows
  const reviewRows: ReviewRow[] = [];
  {
    const baseCols = "id,user_id,suggestion_type,target_entity_id,target_entity_type,applied_at,source_note_id,suppression_key,extracted_value,title,payload,status";
    let from = 0;
    while (true) {
      let q = db.from("review_queue")
        .select(baseCols)
        .eq("user_id", userId)
        .in("status", ["pending", "pending_review", "auto_applied_unreviewed"])
        .order("created_at", { ascending: false })
        .range(from, from + PAGE - 1);
      if (scopedIds) q = q.in("id", scopedIds);
      const { data, error } = await q;
      if (error) throw error;
      if (!data || data.length === 0) break;
      reviewRows.push(...(data as ReviewRow[]));
      if (data.length < PAGE) break;
      from += PAGE;
    }
  }

  // Wiki revisions (only when scope=all, keeps parity with the current UI)
  const wikiIds: string[] = [];
  if (body.scope === "all") {
    let from = 0;
    while (true) {
      const { data, error } = await db.from("wiki_revisions")
        .select("id")
        .eq("user_id", userId)
        .eq("status", "applied")
        .in("change_type", ["created", "updated"])
        .range(from, from + PAGE - 1);
      if (error) throw error;
      if (!data || data.length === 0) break;
      wikiIds.push(...data.map((r: any) => r.id as string));
      if (data.length < PAGE) break;
      from += PAGE;
    }
  }

  const total = reviewRows.length + wikiIds.length;
  await db.from("review_queue_bulk_jobs").update({ total }).eq("id", jobId);

  if (total === 0) {
    await db.from("review_queue_bulk_jobs").update({
      status: "done",
      finished_at: new Date().toISOString(),
    }).eq("id", jobId);
    return;
  }

  let done = 0;
  let failed = 0;
  let lastError: string | null = null;
  let lastFlush = 0;
  const note = (msg: string) => { lastError = msg; };
  const flush = async (force = false) => {
    const now = Date.now();
    if (!force && now - lastFlush < 1500) return;
    lastFlush = now;
    await db.from("review_queue_bulk_jobs").update({ done, failed }).eq("id", jobId);
  };

  try {
    if (body.action === "keep") {
      await runKeep(db, userId, reviewRows, wikiIds, (ok, fail) => { done += ok; failed += fail; }, flush, note);
    } else if (body.action === "rollback") {
      await runRollback(db, userId, reviewRows, wikiIds, (ok, fail) => { done += ok; failed += fail; }, flush, /*block*/ false);
    } else {
      await runRollback(db, userId, reviewRows, wikiIds, (ok, fail) => { done += ok; failed += fail; }, flush, /*block*/ true);
    }
  } finally {
    // Reconcile against reality: whatever is still outstanding failed, the
    // rest succeeded. Never additive, never negative.
    try {
      const outstanding = await countOutstanding(db, reviewRows.map((r) => r.id), wikiIds);
      failed = Math.min(total, outstanding);
      done = Math.max(0, total - failed);
      if (failed > 0 && !lastError) {
        lastError = `${failed} item(s) could not be applied and remain in the queue`;
      }
      if (failed === 0) lastError = null;
    } catch (e) {
      console.warn("review-queue-bulk reconcile failed", e);
    }
    await db.from("review_queue_bulk_jobs").update({
      status: "done",
      done,
      failed,
      ...(lastError ? { last_error: lastError } : {}),
      finished_at: new Date().toISOString(),
    }).eq("id", jobId);
  }
}


// ---------------- KEEP ----------------

async function runKeep(
  db: SupabaseClient,
  userId: string,
  rows: ReviewRow[],
  wikiIds: string[],
  bump: (ok: number, fail: number) => void,
  flush: (force?: boolean) => Promise<void>,
  note: (msg: string) => void,
) {
  // Split by whether they already have side effects (applied_at) or not.
  const applied: ReviewRow[] = [];
  const pending: ReviewRow[] = [];
  for (const r of rows) {
    if (r.target_entity_id && r.applied_at) applied.push(r);
    else pending.push(r);
  }

  // Fast path: bulk flip status for already-applied rows.
  for (let i = 0; i < applied.length; i += PAGE) {
    const chunk = applied.slice(i, i + PAGE);
    const ids = chunk.map((r) => r.id);
    const { error } = await db.from("review_queue")
      .update({ status: "kept", reviewed_at: new Date().toISOString() })
      .in("id", ids);
    if (error) { bump(0, chunk.length); }
    else { bump(chunk.length, 0); }
    await flush();
  }

  // Pending profile-entry approvals: batch via existing normalize-profile action.
  const profileIds = pending.filter((r) => r.suggestion_type === "add_profile_entry").map((r) => r.id);
  for (let i = 0; i < profileIds.length; i += PAGE) {
    const chunk = profileIds.slice(i, i + PAGE);
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/normalize-profile`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SERVICE_ROLE}`,
          apikey: SERVICE_ROLE,
        },
        body: JSON.stringify({ action: "bulk_profile_reviews", decision: "keep", review_ids: chunk, user_id: userId }),
      });
      const j = await res.json().catch(() => ({} as any));
      if (!res.ok || !j?.summary) {
        // A transport/auth failure applies to nothing in the chunk — never
        // report these rows as kept, they are still sitting in the queue.
        console.warn("bulk_profile_reviews failed", res.status, JSON.stringify(j).slice(0, 300));
        bump(0, chunk.length);
      } else {
        // rejected_duplicate rows are left untouched server-side, so they are
        // failures from the queue's point of view, not successes.
        const failedCount = Number(j.summary.failed || 0) + Number(j.summary.rejected_duplicate || 0);
        bump(Math.max(0, chunk.length - failedCount), Math.min(chunk.length, failedCount));
      }
    } catch (e) {
      console.warn("bulk_profile_reviews threw", e);
      bump(0, chunk.length);
    }
    await flush();
  }

  // Remaining pending types: process server-side individually (still fine — no browser cost).
  const others = pending.filter((r) => r.suggestion_type !== "add_profile_entry");
  for (const r of others) {
    try {
      await keepPending(db, userId, r);
      bump(1, 0);
    } catch (e) {
      console.warn("keep failed", r.id, e);
      bump(0, 1);
    }
    await flush();
  }


  // Wiki revisions → mark reviewed (bulk).
  for (let i = 0; i < wikiIds.length; i += PAGE) {
    const chunk = wikiIds.slice(i, i + PAGE);
    const { error } = await db.from("wiki_revisions")
      .update({ status: "reviewed", reviewed_at: new Date().toISOString() })
      .in("id", chunk);
    if (error) bump(0, chunk.length); else bump(chunk.length, 0);
    await flush();
  }

  await flush(true);
}

/**
 * Authoritative reconciliation: "done" must mean the row actually left the
 * queue. Counts what is still outstanding instead of adding to the in-loop
 * counters (which used to double-count failures and produce negative "done").
 */
async function countOutstanding(
  db: SupabaseClient,
  reviewIds: string[],
  wikiIds: string[],
): Promise<number> {
  let outstanding = 0;
  for (let i = 0; i < reviewIds.length; i += PAGE) {
    const chunk = reviewIds.slice(i, i + PAGE);
    const { data, error } = await db.from("review_queue")
      .select("id")
      .in("id", chunk)
      .in("status", ["pending", "pending_review", "auto_applied_unreviewed"]);
    if (error) continue;
    outstanding += data?.length || 0;
  }
  for (let i = 0; i < wikiIds.length; i += PAGE) {
    const chunk = wikiIds.slice(i, i + PAGE);
    const { data, error } = await db.from("wiki_revisions")
      .select("id")
      .in("id", chunk)
      .eq("status", "applied");
    if (error) continue;
    outstanding += data?.length || 0;
  }
  return outstanding;
}



async function keepPending(db: SupabaseClient, userId: string, r: ReviewRow) {
  const p = (r.payload || {}) as any;
  const now = new Date().toISOString();
  const markKept = (extra?: Record<string, unknown>) =>
    db.from("review_queue").update({ status: "kept", reviewed_at: now, ...(extra || {}) }).eq("id", r.id);

  switch (r.suggestion_type) {
    case "normalize_profile_entry": {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/normalize-profile`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_ROLE}`, apikey: SERVICE_ROLE },
        body: JSON.stringify({ action: "apply", review_id: r.id, user_id: userId }),
      });
      const j = await res.json().catch(() => ({} as any));
      // `resolved: true` means the row was closed server-side (stale suggestion).
      if (!res.ok || (j?.ok !== true && j?.resolved !== true)) {
        throw new Error(`normalize-profile apply failed (${res.status}): ${String(j?.reason || j?.error || "unknown")}`);
      }
      return;
    }

    case "add_contact": {
      const name = String(p.name || "").trim();
      if (!name) return void await markKept();
      const { data } = await db.from("contacts").insert({ user_id: userId, name }).select("id").single();
      await markKept(data?.id ? { target_entity_type: "contact", target_entity_id: data.id, applied_at: now } : undefined);
      return;
    }
    case "add_alias": {
      const contactId = p.contact_id as string | undefined;
      const alias = String(p.alias || "").trim();
      if (contactId && alias) {
        const { data: c } = await db.from("contacts").select("aliases").eq("id", contactId).maybeSingle();
        const cur: string[] = Array.isArray(c?.aliases) ? c!.aliases as string[] : [];
        if (!cur.some((a) => a.toLowerCase() === alias.toLowerCase())) {
          await db.from("contacts").update({ aliases: [...cur, alias] }).eq("id", contactId);
        }
      }
      await markKept();
      return;
    }
    case "add_moment": {
      const title = String(p.title || "").trim();
      const happenedAt = String(p.happened_at || "").trim();
      if (!title || !happenedAt) return void await markKept();
      const participants: Array<any> = Array.isArray(p.participants) ? p.participants : [];
      const firstContact = participants.find((x) => x?.contact_id);
      const { data: inserted } = await db.from("moments").insert({
        user_id: userId,
        title,
        description: p.description || null,
        happened_at: happenedAt,
        impact_level: Math.max(1, Math.min(4, Number(p.impact_level) || 2)),
        confidence_date: Math.max(0, Math.min(10, Number(p.confidence_date) || 7)),
        confidence_truth: Math.max(0, Math.min(10, Number(p.confidence_truth) || 7)),
        person_id: firstContact?.contact_id || null,
        source: "note_auto",
        status: "happened",
      } as any).select("id").single();
      if (inserted?.id) {
        const partRows = participants.filter((x) => x?.contact_id).map((x) => ({ moment_id: inserted.id, person_id: x.contact_id }));
        if (partRows.length > 0) await db.from("moment_participants").insert(partRows as any);
      }
      await markKept(inserted?.id ? { target_entity_type: "moment", target_entity_id: inserted.id, applied_at: now } : undefined);
      return;
    }
    case "add_relationship": {
      const label = String(p.label || "").trim();
      const relationshipDecision = relationshipWriteDecision({
        userId,
        sourceType: p.source_type,
        sourceId: p.source_id || null,
        targetType: p.target_type,
        targetId: p.target_id || null,
        label,
      });
      if (relationshipDecision.ok === false) {
        await markKept();
        return;
      }
      // A bulk "keep" is a human confirmation, so it is exempt from the
      // evidence gate — but it may NEVER masquerade as something it is not:
      // with a quote it is recorded as review_queue, without one as the
      // manual user action it actually is.
      const relEvidenceQuote = String(p.evidence_quote || "").trim();
      const hasQuote = relEvidenceQuote.length >= 10;
      if (hasQuote) {
        const verdict = await adjudicateRelationship({
          db,
          userId,
          candidate: {
            personA: String(p.contact_name_a || p.person_a || ""),
            personB: String(p.contact_name_b || p.person_b || ""),
            label: relationshipDecision.label,
            inverseLabel: p.inverse_label || null,
            sourceQuote: relEvidenceQuote,
            sourceContext: String(p.source_context || relEvidenceQuote),
          },
        });
        if (verdict.outcome !== "keep") {
          await markKept();
          return;
        }
      }
      const { data: inserted, error } = await db.from("contact_relationships").insert({
        user_id: userId,
        source_type: p.source_type,
        source_id: p.source_id || null,
        target_type: p.target_type,
        target_id: p.target_id || null,
        label: relationshipDecision.label,
        custom_label: p.custom_label || null,
        origin: hasQuote ? "review_queue" : "user_manual",
        evidence_quote: hasQuote ? relEvidenceQuote : null,
        evidence_note_id: p.note_id || null,
      }).select("id").maybeSingle();
      if (error) throw error;
      if (!inserted) {
        // A deterministic guard (dedup / rejection ledger) absorbed the write.
        await markKept();
        return;
      }
      await markKept(inserted?.id ? { target_entity_type: "relationship", target_entity_id: inserted.id, applied_at: now } : undefined);
      return;
    }
    case "group_member_suggestion": {
      const groupId = p.group_id as string | undefined;
      const contactId = p.contact_id as string | undefined;
      if (!groupId || !contactId) return void await markKept();
      const { data: existing } = await db.from("contact_group_memberships")
        .select("id").eq("group_id", groupId).eq("contact_id", contactId).is("archived_at", null).maybeSingle();
      let membershipId = existing?.id || r.target_entity_id || null;
      if (!membershipId) {
        const { data } = await db.from("contact_group_memberships").insert({
          user_id: userId, group_id: groupId, contact_id: contactId,
          status: p.default_status || null,
          reason: r.title || null,
        }).select("id").single();
        membershipId = data?.id || null;
      }
      await markKept(membershipId ? { target_entity_type: "contact_group_membership", target_entity_id: membershipId, applied_at: r.applied_at || now } : undefined);
      return;
    }
    case "unknown_profile_field": {
      const categorySlug = String(p.category_slug || "").trim();
      const canonicalLabel = String(p.canonical_label || p.label || "").trim();
      const value = String(p.value || "").trim();
      const categoryId = p.category_id as string | undefined;
      if (!categorySlug || !canonicalLabel || !value || !categoryId) {
        await markKept();
        return;
      }
      await db.from("profile_fields").insert({
        user_id: userId,
        category_slug: categorySlug,
        canonical_label: canonicalLabel,
        cardinality: "list",
        value_type: "text",
        aliases: [],
        is_system: false,
        is_active: true,
      }).select("id").single();
      const { data: entry, error } = await db.from("profile_entries").insert({
        user_id: userId,
        contact_id: p.contact_id || null,
        category_id: categoryId,
        label: canonicalLabel,
        value,
        origin: r.source_note_id ? "review_queue" : "user_manual",
        evidence_quote: p.evidence_quote || null,
        linked_note_id: p.linked_note_id || r.source_note_id || null,
      }).select("id").single();
      if (error) throw error;
      await markKept(entry?.id ? { target_entity_type: "profile_entry", target_entity_id: entry.id, applied_at: now } : undefined);
      return;
    }
    default: {
      await markKept();
      return;
    }
  }
}

// ---------------- ROLLBACK / NEVER AGAIN ----------------

async function runRollback(
  db: SupabaseClient,
  userId: string,
  rows: ReviewRow[],
  wikiIds: string[],
  bump: (ok: number, fail: number) => void,
  flush: (force?: boolean) => Promise<void>,
  block: boolean,
) {
  const now = new Date().toISOString();
  const finalStatus = block ? "blocked" : "removed";

  // Suppressions first (only for never_again).
  if (block) {
    const supRows = rows.map((r) => {
      const normalizedValue = String(
        r.extracted_value ||
        (r.payload as any)?.name ||
        (r.payload as any)?.value ||
        (r.payload as any)?.alias ||
        r.title || ""
      ).trim().toLowerCase();
      const key = r.suppression_key ||
        `${r.suggestion_type}:${r.target_entity_type || "none"}:${r.target_entity_id || "none"}:${normalizedValue}`;
      return {
        user_id: userId,
        suggestion_type: r.suggestion_type,
        target_entity_type: r.target_entity_type,
        target_entity_id: r.target_entity_id,
        normalized_value: normalizedValue,
        source_category: typeof (r.payload as any)?.category_slug === "string" ? (r.payload as any).category_slug : null,
        suppression_key: key,
      };
    });
    for (let i = 0; i < supRows.length; i += PAGE) {
      const chunk = supRows.slice(i, i + PAGE);
      await db.from("ai_suggestion_suppressions").upsert(chunk as any, { onConflict: "user_id,suppression_key" });
    }
  }

  // Revert side-effects per row (only where a target_entity_id exists).
  for (const r of rows) {
    try {
      await revertOne(db, userId, r);
      bump(1, 0);
    } catch (e) {
      console.warn("rollback failed", r.id, e);
      bump(0, 1);
    }
    await flush();
  }

  // Bulk flip status in one UPDATE per page.
  const ids = rows.map((r) => r.id);
  for (let i = 0; i < ids.length; i += PAGE) {
    const chunk = ids.slice(i, i + PAGE);
    const patch: Record<string, unknown> = { status: finalStatus, reviewed_at: now };
    if (block) patch.blocked_at = now;
    await db.from("review_queue").update(patch).in("id", chunk);
  }

  // Wiki revisions — rollback via existing RPC (per-row; runs server-side).
  for (const id of wikiIds) {
    try {
      // wiki_rollback_revision uses auth.uid(); call it as the user via anon client with impersonated JWT
      // isn't practical here — fall back to a direct revert done with service role.
      await wikiRollbackAsService(db, userId, id);
      bump(1, 0);
    } catch (e) {
      console.warn("wiki rollback failed", id, e);
      bump(0, 1);
    }
    await flush();
  }

  await flush(true);
}

async function revertOne(db: SupabaseClient, userId: string, r: ReviewRow) {
  const p = (r.payload || {}) as any;

  if (r.suggestion_type === "normalize_profile_entry") {
    await fetch(`${SUPABASE_URL}/functions/v1/normalize-profile`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_ROLE}`, apikey: SERVICE_ROLE },
      body: JSON.stringify({ action: "rollback", review_id: r.id, user_id: userId }),
    });
    return;
  }

  if (!r.target_entity_id) {
    // add_alias may still need reverting even without a target row.
    if (r.suggestion_type === "add_alias") {
      const contactId = p.contact_id as string | undefined;
      const alias = String(p.alias || "").trim();
      if (contactId && alias) {
        const { data: c } = await db.from("contacts").select("aliases").eq("id", contactId).maybeSingle();
        const cur: string[] = Array.isArray(c?.aliases) ? c!.aliases as string[] : [];
        await db.from("contacts").update({ aliases: cur.filter((a) => a.toLowerCase() !== alias.toLowerCase()) }).eq("id", contactId);
      }
    }
    return;
  }

  switch (r.suggestion_type) {
    case "add_contact":
      await db.from("contacts").delete().eq("id", r.target_entity_id).eq("user_id", userId);
      return;
    case "add_profile_entry":
      await db.from("profile_entries").delete().eq("id", r.target_entity_id).eq("user_id", userId);
      return;
    case "add_relationship":
      await db.from("contact_relationships").delete().eq("id", r.target_entity_id).eq("user_id", userId);
      return;
    case "add_moment":
      await db.from("moment_participants").delete().eq("moment_id", r.target_entity_id);
      await db.from("moments").delete().eq("id", r.target_entity_id).eq("user_id", userId);
      return;
    case "add_alias": {
      const contactId = p.contact_id as string | undefined;
      const alias = String(p.alias || "").trim();
      if (contactId && alias) {
        const { data: c } = await db.from("contacts").select("aliases").eq("id", contactId).maybeSingle();
        const cur: string[] = Array.isArray(c?.aliases) ? c!.aliases as string[] : [];
        await db.from("contacts").update({ aliases: cur.filter((a) => a.toLowerCase() !== alias.toLowerCase()) }).eq("id", contactId);
      }
      return;
    }
    case "group_member_suggestion":
      await db.from("contact_group_memberships").delete().eq("id", r.target_entity_id).eq("user_id", userId);
      return;
    case "unknown_profile_field":
      // If a target row was written, delete the value. The field definition
      // stays so any manual edits are not lost.
      if (r.target_entity_id) {
        await db.from("profile_entries").delete().eq("id", r.target_entity_id).eq("user_id", userId);
      }
      return;
    default:
      return;
  }
}

async function wikiRollbackAsService(db: SupabaseClient, userId: string, revisionId: string) {
  // Mirror wiki_rollback_revision semantics without relying on auth.uid().
  const { data: rev, error } = await db.from("wiki_revisions").select("*").eq("id", revisionId).eq("user_id", userId).maybeSingle();
  if (error || !rev) return;
  if (rev.change_type === "created") {
    if (rev.wiki_page_id) {
      await db.from("wiki_pages").delete().eq("id", rev.wiki_page_id).eq("user_id", userId);
    }
  } else if (rev.change_type === "updated") {
    if (rev.wiki_page_id) {
      await db.from("wiki_pages").update({ content: rev.previous_content ?? "" }).eq("id", rev.wiki_page_id).eq("user_id", userId);
    }
  }
  await db.from("wiki_revisions").update({ status: "rolled_back", rolled_back_at: new Date().toISOString() }).eq("id", revisionId);
}
