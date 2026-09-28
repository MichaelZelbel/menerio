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
import { findOrCreateContact } from "../_shared/find-or-create-contact.ts";
import { suppressionKey, writeFact, type FactSubject } from "../_shared/fact-store.ts";
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

type KeepOutcome =
  | { kind: "applied" }
  | { kind: "already_satisfied"; reason?: string; leftPending?: boolean }
  | { kind: "skipped"; reason: string };

type RollbackStats = {
  /** Rows left active because their fact cannot be reverted. */
  notRevertible: Set<string>;
  superseded: number;
};

type KeepStats = {
  applied: number; alreadySatisfied: number; skipped: number; skipReasons: Map<string, number>;
  /** Rows deliberately left in the queue (judge unavailable / wants a human). */
  leftPending: Set<string>;
};

const emptyKeepStats = (): KeepStats => ({ applied: 0, alreadySatisfied: 0, skipped: 0, skipReasons: new Map(), leftPending: new Set() });

function recordKeepOutcome(stats: KeepStats, outcome: KeepOutcome) {
  if (outcome.kind === "applied") stats.applied += 1;
  else if (outcome.kind === "already_satisfied") stats.alreadySatisfied += 1;
  else {
    stats.skipped += 1;
    stats.skipReasons.set(outcome.reason, (stats.skipReasons.get(outcome.reason) || 0) + 1);
  }
}

function humanizeReason(reason: string) {
  return reason.replaceAll("_", " ");
}

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
        // Newest first: a rollback only succeeds while the page still holds
        // what that revision wrote, so the later revisions of a page must be
        // undone before the earlier ones.
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
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
  const keepStats = emptyKeepStats();
  const rollbackStats: RollbackStats = { notRevertible: new Set(), superseded: 0 };
  let lastFlush = 0;
  const note = (msg: string) => { lastError = msg; };
  const flush = async (force = false) => {
    const now = Date.now();
    if (!force && now - lastFlush < 1500) return;
    lastFlush = now;
    await db.from("review_queue_bulk_jobs").update({ done, failed }).eq("id", jobId);
  };

  if (body.action === "keep") {
    await runKeep(db, userId, reviewRows, wikiIds, (ok, fail) => { done += ok; failed += fail; }, flush, note, keepStats);
  } else if (body.action === "rollback") {
    await runRollback(db, userId, reviewRows, wikiIds, (ok, fail) => { done += ok; failed += fail; }, flush, /*block*/ false, rollbackStats);
  } else {
    await runRollback(db, userId, reviewRows, wikiIds, (ok, fail) => { done += ok; failed += fail; }, flush, /*block*/ true, rollbackStats);
  }

  // A completed Keep is terminal. Any remaining active row means an
  // unexpected backend failure, so fail the job instead of claiming success.
  // Rows the keep deliberately left pending are not failures; counting them
  // failed the whole job ("N item(s) were not resolved") and lost its stats.
  // Rows a rollback could not revert (a fact that is no longer only the
  // machine's, or whose entry was folded at the fact-store switch) stay in the
  // queue on purpose and are reported below.
  const outstanding = await countOutstanding(db, reviewRows.map((r) => r.id).filter((id) => !keepStats.leftPending.has(id) && !rollbackStats.notRevertible.has(id)), wikiIds);
  if (outstanding > 0) throw new Error(`${outstanding} item(s) were not resolved`);
  failed = 0;
  done = total;
  if (body.action === "keep") {
    const parts: string[] = [];
    if (keepStats.alreadySatisfied > 0) parts.push(`${keepStats.alreadySatisfied} already_present`);
    if (keepStats.skipped > 0) {
      const reasons = [...keepStats.skipReasons.entries()].map(([reason, count]) => `${count} ${humanizeReason(reason)}`).join(", ");
      parts.push(`${keepStats.skipped} skipped${reasons ? ` (${reasons})` : ""}`);
    }
    lastError = parts.join("; ") || null;
  } else {
    const parts: string[] = [];
    if (rollbackStats.notRevertible.size > 0) parts.push(`${rollbackStats.notRevertible.size} not revertible`);
    if (rollbackStats.superseded > 0) parts.push(`${rollbackStats.superseded} superseded`);
    lastError = parts.join("; ") || null;
  }
  const { error: finishError } = await db.from("review_queue_bulk_jobs").update({
    status: "done",
    done,
    failed,
    last_error: lastError,
    finished_at: new Date().toISOString(),
  }).eq("id", jobId);
  if (finishError) throw finishError;
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
  stats: KeepStats,
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
      .in("id", ids)
      .eq("user_id", userId);
    if (error) throw error;
    bump(chunk.length, 0);
    stats.applied += chunk.length;
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
      if (!res.ok || !j?.summary) throw new Error(`profile review service failed (${res.status})`);
      if (Number(j.summary.failed || 0) > 0) throw new Error(`${j.summary.failed} profile review write(s) failed unexpectedly`);
      stats.applied += Number(j.summary.inserted || 0) + Number(j.summary.merged_list || 0);
      stats.alreadySatisfied += Number(j.summary.already_exists || 0);

      // Deterministic validation rejections are terminal: archive the rows the
      // profile service intentionally left active and preserve the reason.
      const { data: rejected, error: rejectedError } = await db.from("review_queue")
        .select("id,payload").in("id", chunk).in("status", ["pending", "pending_review", "auto_applied_unreviewed"]);
      if (rejectedError) throw rejectedError;
      for (const rejectedRow of rejected || []) {
        await archiveSkipped(db, rejectedRow as Pick<ReviewRow, "id" | "payload">, "profile validation rejected the suggestion");
        recordKeepOutcome(stats, { kind: "skipped", reason: "profile_validation" });
      }
      bump(chunk.length, 0);
    } catch (e) {
      console.warn("bulk_profile_reviews threw", e);
      throw e;
    }
    await flush();
  }

  // Remaining pending types: process server-side individually (still fine — no browser cost).
  const others = pending.filter((r) => r.suggestion_type !== "add_profile_entry");
  for (const r of others) {
    try {
      const outcome = await keepPending(db, userId, r);
      if (outcome.kind === "already_satisfied" && outcome.leftPending) stats.leftPending.add(r.id);
      recordKeepOutcome(stats, outcome);
      bump(1, 0);
    } catch (e) {
      console.warn("keep failed", r.id, e);
      throw e;
    }
    await flush();
  }


  // Wiki revisions → mark reviewed (bulk).
  for (let i = 0; i < wikiIds.length; i += PAGE) {
    const chunk = wikiIds.slice(i, i + PAGE);
    const { error } = await db.from("wiki_revisions")
      .update({ status: "reviewed", reviewed_at: new Date().toISOString() })
      .in("id", chunk);
    if (error) throw error;
    bump(chunk.length, 0);
    stats.applied += chunk.length;
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



async function archiveSkipped(db: SupabaseClient, r: Pick<ReviewRow, "id" | "payload">, reason: string) {
  const payload = { ...(r.payload || {}), review_resolution: { outcome: "skipped", reason } };
  const { error } = await db.from("review_queue").update({
    status: "removed",
    reviewed_at: new Date().toISOString(),
    payload,
  }).eq("id", r.id);
  if (error) throw error;
}

async function keepPending(db: SupabaseClient, userId: string, r: ReviewRow): Promise<KeepOutcome> {
  const p = (r.payload || {}) as any;
  const now = new Date().toISOString();
  const markKept = async (extra?: Record<string, unknown>) => {
    const { error } = await db.from("review_queue").update({ status: "kept", reviewed_at: now, ...(extra || {}) }).eq("id", r.id).eq("user_id", userId);
    if (error) throw error;
  };
  const skip = async (reason: string): Promise<KeepOutcome> => {
    await archiveSkipped(db, r, reason);
    return { kind: "skipped", reason };
  };

  switch (r.suggestion_type) {
    case "normalize_profile_entry": {
      // The normalizer is retired (normalize-profile answers 410): facts are
      // cleaned when they are written. Its open suggestions are superseded.
      await markSuperseded(db, userId, r.id);
      return { kind: "already_satisfied", reason: "profile cleanup retired, superseded" };
    }

    case "add_contact": {
      const name = String(p.name || "").trim();
      if (!name) return skip("missing contact name");
      // Two notes can each propose the same new person, and a bulk keep used
      // to create one contact per suggestion: twelve people existed twice on
      // 2026-09-04. The second keep now lands on the person the first made.
      const found = await findOrCreateContact(db, userId, name);
      await markKept({ target_entity_type: "contact", target_entity_id: found.id, applied_at: now });
      return found.created ? { kind: "applied" } : { kind: "already_satisfied", reason: `"${name}" is already in People` };
    }
    case "add_alias": {
      const contactId = p.contact_id as string | undefined;
      const alias = String(p.alias || "").trim();
      let alreadyPresent = false;
      if (contactId && alias) {
        const { data: c, error } = await db.from("contacts").select("aliases").eq("id", contactId).eq("user_id", userId).maybeSingle();
        if (error) throw error;
        if (!c) return skip("contact not found");
        const cur: string[] = Array.isArray(c?.aliases) ? c!.aliases as string[] : [];
        alreadyPresent = cur.some((a) => a.toLowerCase() === alias.toLowerCase());
        if (!alreadyPresent) {
          const { error: updateError } = await db.from("contacts").update({ aliases: [...cur, alias] }).eq("id", contactId).eq("user_id", userId);
          if (updateError) throw updateError;
        }
      } else {
        return skip("missing contact or alias");
      }
      await markKept();
      return alreadyPresent ? { kind: "already_satisfied", reason: "alias exists" } : { kind: "applied" };
    }
    case "add_moment": {
      const title = String(p.title || "").trim();
      const happenedAt = String(p.happened_at || "").trim();
      if (!title || !happenedAt) return skip("missing moment title or date");
      const participants: Array<any> = Array.isArray(p.participants) ? p.participants : [];
      const firstContact = participants.find((x) => x?.contact_id);
      const { data: inserted, error } = await db.from("moments").insert({
        user_id: userId,
        title,
        description: p.description || null,
        happened_at: happenedAt,
        impact_level: Math.max(1, Math.min(4, Number(p.impact_level) || 2)),
        confidence_date: Math.max(0, Math.min(10, Number(p.confidence_date) || 7)),
        confidence_truth: Math.max(0, Math.min(10, Number(p.confidence_truth) || 7)),
        person_id: firstContact?.contact_id || null,
        source: "note_auto",
        status: "past_fact",
      } as any).select("id").single();
      if (error) throw error;
      if (inserted?.id) {
        const partRows = participants.filter((x) => x?.contact_id).map((x) => ({ moment_id: inserted.id, person_id: x.contact_id }));
        if (partRows.length > 0) await db.from("moment_participants").insert(partRows as any);
      }
      await markKept(inserted?.id ? { target_entity_type: "moment", target_entity_id: inserted.id, applied_at: now } : undefined);
      return { kind: "applied" };
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
        return skip(relationshipDecision.reason);
      }
      // A bulk "keep" is a human confirmation, so it is exempt from the
      // evidence gate — but it may NEVER masquerade as something it is not:
      // with a quote it is recorded as review_queue, without one as the
      // manual user action it actually is.
      const relEvidenceQuote = String(p.evidence_quote || "").trim();
      const hasQuote = relEvidenceQuote.length >= 10;
      if (hasQuote) {
        let judgeUnavailable = false;
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
          onJudgeUnavailable: () => { judgeUnavailable = true; },
        });
        // Only a judged rejection archives the row. When the judge could not
        // run (no credits, provider down, unparseable answer) the outcome is
        // "review" with confidence 0, and archiving that threw away the user's
        // own confirmation: forty quoted suggestions bulk-kept on an empty
        // balance were all filed as removed with nothing created. Such rows
        // stay pending for the next attempt.
        if (verdict.outcome === "reject") {
          return skip(`relationship ${verdict.outcome}`);
        }
        if (verdict.outcome !== "keep") {
          return { kind: "already_satisfied", leftPending: true, reason: judgeUnavailable ? "evidence judge unavailable, left pending" : "evidence needs a human look, left pending" };
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
        return { kind: "already_satisfied", reason: "relationship guard" };
      }
      await markKept(inserted?.id ? { target_entity_type: "relationship", target_entity_id: inserted.id, applied_at: now } : undefined);
      return { kind: "applied" };
    }
    case "group_member_suggestion": {
      const groupId = p.group_id as string | undefined;
      const contactId = p.contact_id as string | undefined;
      if (!groupId || !contactId) return skip("missing group or contact");
      const { data: existing } = await db.from("contact_group_memberships")
        .select("id").eq("group_id", groupId).eq("contact_id", contactId).is("archived_at", null).maybeSingle();
      let membershipId = existing?.id || r.target_entity_id || null;
      if (!membershipId) {
        const { data, error } = await db.from("contact_group_memberships").insert({
          user_id: userId, group_id: groupId, contact_id: contactId,
          status: p.default_status || null,
          reason: r.title || null,
        }).select("id").single();
        if (error) throw error;
        membershipId = data?.id || null;
      }
      await markKept(membershipId ? { target_entity_type: "contact_group_membership", target_entity_id: membershipId, applied_at: r.applied_at || now } : undefined);
      return existing?.id ? { kind: "already_satisfied", reason: "membership exists" } : { kind: "applied" };
    }
    case "unknown_profile_field": {
      const categorySlug = String(p.category_slug || "").trim();
      const canonicalLabel = String(p.canonical_label || p.label || "").trim();
      const value = String(p.value || "").trim();
      if (!categorySlug || !canonicalLabel || !value) {
        return skip("missing required profile data");
      }
      const { data: existingField, error: fieldLookupError } = await db.from("profile_fields")
        .select("id").eq("category_slug", categorySlug).ilike("canonical_label", canonicalLabel)
        .or(`user_id.eq.${userId},is_system.eq.true`).limit(1).maybeSingle();
      if (fieldLookupError) throw fieldLookupError;
      if (!existingField) {
        const { error: fieldInsertError } = await db.from("profile_fields").insert({
          user_id: userId,
          category_slug: categorySlug,
          canonical_label: canonicalLabel,
          cardinality: "list",
          value_type: "text",
          aliases: [],
          is_system: false,
          is_active: true,
        }).select("id").maybeSingle();
        if (fieldInsertError && fieldInsertError.code !== "23505") throw fieldInsertError;
      }

      // The one write path (fact-store.ts). Accepting from the queue is the
      // user's decision about a machine's fact: origin review_queue, written
      // as a machine (it only inserts, it never closes a human's value).
      const quote = String(p.evidence_quote || "").trim();
      const result = await writeFact(db, userId, {
        subject: p.contact_id ? { type: "contact", id: String(p.contact_id) } : { type: "self", id: null },
        label: canonicalLabel,
        value,
        origin: "review_queue",
        categorySlug,
        evidenceQuote: quote || null,
        sourceType: r.source_note_id ? "note" : "ai",
        sourceId: r.source_note_id || null,
      }, { isHuman: false });
      const inserted = result.facts.find((f) => f.outcome === "inserted" && f.claimId);
      if (inserted) {
        await markKept({ target_entity_type: "claim", target_entity_id: inserted.claimId, applied_at: now });
        return { kind: "applied" };
      }
      const existing = result.facts.find((f) => (f.outcome === "already_recorded" || f.outcome === "history_not_revived") && f.claimId);
      if (existing) {
        await markKept({ target_entity_type: "claim", target_entity_id: existing.claimId, applied_at: now });
        return { kind: "already_satisfied", reason: "fact already present" };
      }
      if (result.facts.some((f) => f.outcome === "suppressed")) return skip("value was marked wrong before");
      return skip(result.facts.find((f) => f.reason)?.reason ?? "profile integrity guard rejected the fact");
    }
    default: {
      await markKept();
      return { kind: "already_satisfied", reason: "no application required" };
    }
  }
}

async function markSuperseded(db: SupabaseClient, userId: string, id: string) {
  const { error } = await db.from("review_queue")
    .update({ status: "superseded", reviewed_at: new Date().toISOString() })
    .eq("id", id).eq("user_id", userId);
  if (error) throw error;
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
  stats: RollbackStats,
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
  const revertFailed = new Set<string>();
  const leaveAlone = new Set<string>();
  for (const r of rows) {
    try {
      const outcome = await revertOne(db, userId, r);
      if (outcome === "not_revertible") { stats.notRevertible.add(r.id); leaveAlone.add(r.id); }
      if (outcome === "superseded") { stats.superseded += 1; leaveAlone.add(r.id); }
      bump(1, 0);
    } catch (e) {
      console.warn("rollback failed", r.id, e);
      revertFailed.add(r.id);
      bump(0, 1);
    }
    await flush();
  }

  // Bulk flip status in one UPDATE per page — but only for rows whose revert
  // succeeded. Closing a row whose revert threw would leave the AI-created
  // entity in the brain while the queue reports a clean success; leaving it
  // active instead lets countOutstanding() surface the failure and keeps the
  // row available for retry.
  const ids = rows.filter((r) => !revertFailed.has(r.id) && !leaveAlone.has(r.id)).map((r) => r.id);
  for (let i = 0; i < ids.length; i += PAGE) {
    const chunk = ids.slice(i, i + PAGE);
    const patch: Record<string, unknown> = { status: finalStatus, reviewed_at: now };
    if (block) patch.blocked_at = now;
    await db.from("review_queue").update(patch).in("id", chunk).eq("user_id", userId);
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

// supabase-js returns errors instead of throwing them. Every revert below used
// to ignore them, so a failed delete was still counted as reverted and the
// review item filed as removed (or blocked) while the AI's row stayed put.
function must<T>(result: { data: T; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

type RevertOutcome = "reverted" | "superseded" | "not_revertible";

async function revertOne(db: SupabaseClient, userId: string, r: ReviewRow): Promise<RevertOutcome> {
  const p = (r.payload || {}) as any;

  if (r.suggestion_type === "normalize_profile_entry") {
    // The normalizer is retired (normalize-profile answers 410); its merges
    // cannot be undone any more. The item is superseded.
    await markSuperseded(db, userId, r.id);
    return "superseded";
  }

  if (r.suggestion_type === "add_profile_entry" || r.suggestion_type === "unknown_profile_field") {
    return revertFact(db, userId, r);
  }

  if (!r.target_entity_id) {
    // add_alias may still need reverting even without a target row.
    if (r.suggestion_type === "add_alias") {
      const contactId = p.contact_id as string | undefined;
      const alias = String(p.alias || "").trim();
      if (contactId && alias) {
        // contact_id comes from the payload, which its owner can write.
        const c = must(await db.from("contacts").select("aliases").eq("id", contactId).eq("user_id", userId).maybeSingle());
        if (!c) return;
        const cur: string[] = Array.isArray(c?.aliases) ? c!.aliases as string[] : [];
        must(await db.from("contacts").update({ aliases: cur.filter((a) => a.toLowerCase() !== alias.toLowerCase()) }).eq("id", contactId).eq("user_id", userId));
      }
    }
    return "reverted";
  }

  switch (r.suggestion_type) {
    case "add_contact":
      must(await db.from("contacts").delete().eq("id", r.target_entity_id).eq("user_id", userId));
      return "reverted";
    case "add_relationship":
      must(await db.from("contact_relationships").delete().eq("id", r.target_entity_id).eq("user_id", userId));
      return "reverted";
    case "add_moment": {
      // target_entity_id is user-writable: only touch a moment this user owns.
      const m = must(await db.from("moments").select("id").eq("id", r.target_entity_id).eq("user_id", userId).maybeSingle());
      if (!m) return "reverted";
      // Participants cascade from the moment; deleting them first left a
      // moment with nobody in it whenever the moment delete then failed.
      must(await db.from("moments").delete().eq("id", m.id).eq("user_id", userId));
      return "reverted";
    }
    case "add_alias": {
      const contactId = p.contact_id as string | undefined;
      const alias = String(p.alias || "").trim();
      if (contactId && alias) {
        // contact_id comes from the payload, which its owner can write.
        const c = must(await db.from("contacts").select("aliases").eq("id", contactId).eq("user_id", userId).maybeSingle());
        if (!c) return "reverted";
        const cur: string[] = Array.isArray(c?.aliases) ? c!.aliases as string[] : [];
        must(await db.from("contacts").update({ aliases: cur.filter((a) => a.toLowerCase() !== alias.toLowerCase()) }).eq("id", contactId).eq("user_id", userId));
      }
      return "reverted";
    }
    case "group_member_suggestion":
      must(await db.from("contact_group_memberships").delete().eq("id", r.target_entity_id).eq("user_id", userId));
      return "reverted";
    default:
      return "reverted";
  }
}

/**
 * Revert an applied profile fact: "this was wrong". The item's target is the
 * claim it wrote (a split bag lists every claim in payload.claim_ids). Each
 * claim is deleted and a "never suggest again" row is written for it, so the
 * value does not come back from the same note.
 *
 * Not revertible, and left in the queue: items the fact-store switch marked
 * so (their entry was folded into another claim, or no longer existed), items
 * still pointing at the retired profile table, and claims a human has made
 * their own since (rank 'preferred': their words, which a Revert must not
 * delete). The field definition of an unknown_profile_field item stays.
 */
async function revertFact(db: SupabaseClient, userId: string, r: ReviewRow): Promise<RevertOutcome> {
  const p = (r.payload || {}) as any;
  if (!r.target_entity_id) return "reverted"; // nothing was written
  const switchInfo = p.fact_store_switch || {};
  if (switchInfo.revertible === false || switchInfo.entry_missing === true) return "not_revertible";
  if (r.target_entity_type !== "claim") return "not_revertible";

  const ids = [...new Set([r.target_entity_id, ...(Array.isArray(p.claim_ids) ? p.claim_ids.map(String) : [])])];
  const claims = must(await db.from("claims")
    .select("id, subject_type, subject_id, attribute, value, rank")
    .eq("user_id", userId)
    .in("id", ids)) as Array<{ id: string; subject_type: FactSubject["type"]; subject_id: string | null; attribute: string; value: string; rank: string }>;
  if ((claims || []).some((c) => c.rank === "preferred")) return "not_revertible";

  for (const c of claims || []) {
    // The suppression first: should the delete fail, the value is still
    // never suggested again, and the item stays active for another try.
    must(await db.from("ai_suggestion_suppressions").upsert({
      user_id: userId,
      suggestion_type: "claim",
      target_entity_type: "claim",
      target_entity_id: c.id,
      normalized_value: String(c.value ?? "").trim().toLowerCase(),
      suppression_key: suppressionKey({ type: c.subject_type, id: c.subject_id }, c.attribute, c.value),
    } as any, { onConflict: "user_id,suppression_key" }));
    const deleted = must(await db.from("claims").delete().eq("id", c.id).eq("user_id", userId).select("id")) as Array<{ id: string }> | null;
    // A claim guard can cancel a delete without an error; say so instead of
    // reporting a revert that did not happen.
    if (!deleted || deleted.length === 0) throw new Error("claim delete was refused");
  }
  return "reverted";
}

async function wikiRollbackAsService(db: SupabaseClient, userId: string, revisionId: string) {
  // Same function the single rollback button calls, so both refuse to undo a
  // revision whose page has changed since (it would erase the later changes),
  // lock the page, and write the rollback record. The direct writes that stood
  // here overwrote the page unconditionally and ignored every error.
  const { error } = await db.rpc("wiki_rollback_revision_for", { p_user_id: userId, p_revision_id: revisionId });
  if (error) throw new Error(error.message);
}
