import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "npm:zod@3.25.76";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { canonicalLabel } from "../_shared/relationship-canonical.ts";
import { isBlockedRelationshipLabel, profileValueDecision } from "../_shared/profile-integrity.ts";
import {
  RELATIONSHIP_ADJUDICATION_VERSION,
  adjudicateRelationship,
  exactQuoteExists,
  noteContentHash,
  recoverRelationshipEvidence,
} from "../_shared/relationship-adjudicator.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const admin = createClient(supabaseUrl, serviceRoleKey);

const BodySchema = z.object({
  action: z.enum(["lint", "start_relationship_repair", "continue_relationship_repair", "relationship_repair_status", "rollback_relationship_repair_item"]).optional().default("lint"),
  contact_id: z.string().uuid().nullable().optional(),
  repair: z.boolean().optional().default(false),
  queue_review: z.boolean().optional().default(true),
  scope: z.enum(["user", "all_users"]).optional().default("user"),
  repair_run_id: z.string().uuid().optional(),
  repair_item_id: z.string().uuid().optional(),
  batch_size: z.coerce.number().int().min(1).max(25).optional().default(8),
});

type RelationshipRow = {
  id: string;
  user_id: string;
  source_type: string;
  source_id: string | null;
  target_type: string;
  target_id: string | null;
  label: string;
  custom_label: string | null;
  pair_key?: string | null;
};

type ContactRow = { id: string; name: string | null };

type Violation = { id: string; reason: string; label: string; value?: string };

function entityName(row: RelationshipRow, side: "source" | "target", names: Map<string, string>): string {
  const type = side === "source" ? row.source_type : row.target_type;
  const id = side === "source" ? row.source_id : row.target_id;
  return type === "self" ? "Me" : names.get(id || "") || "Unknown";
}

async function findRelationshipSource(userId: string, relationshipId: string) {
  const { data } = await admin
    .from("review_queue")
    .select("source_note_id,payload,description")
    .eq("user_id", userId)
    .eq("suggestion_type", "add_relationship")
    .eq("target_entity_id", relationshipId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data as { source_note_id: string | null; payload: Record<string, unknown> | null; description: string | null } | null;
}

async function processRelationshipRepairBatch(userId: string, runId: string, batchSize: number) {
  const { data: run, error: runError } = await admin.from("relationship_repair_runs").select("*").eq("id", runId).eq("user_id", userId).single();
  if (runError || !run) throw runError || new Error("Repair run not found");
  if (["completed", "failed"].includes(run.status)) return run;

  await admin.from("relationship_repair_runs").update({ status: "running", started_at: run.started_at || new Date().toISOString() }).eq("id", runId);
  let query = admin.from("contact_relationships").select("id,user_id,source_type,source_id,target_type,target_id,label,custom_label,pair_key,created_at").eq("user_id", userId).order("created_at").order("id").limit(batchSize);
  if (run.cursor_created_at) query = query.or(`created_at.gt.${run.cursor_created_at},and(created_at.eq.${run.cursor_created_at},id.gt.${run.cursor_id})`);
  const { data: batch, error } = await query;
  if (error) throw error;
  if (!batch?.length) {
    const { data: completed } = await admin.from("relationship_repair_runs").update({ status: "completed", completed_at: new Date().toISOString() }).eq("id", runId).select("*").single();
    return completed;
  }

  const { data: contacts } = await admin.from("contacts").select("id,name").eq("user_id", userId);
  const names = new Map((contacts || []).map((contact: ContactRow) => [contact.id, contact.name || "Unnamed"]));
  const counters = { kept_count: 0, removed_count: 0, merged_count: 0, relabeled_count: 0, queued_count: 0, failed_count: 0 };

  for (const raw of batch) {
    const row = raw as RelationshipRow & { created_at: string };
    const nameA = entityName(row, "source", names);
    const nameB = entityName(row, "target", names);
    try {
      const source = await findRelationshipSource(userId, row.id);
      const noteId = source?.source_note_id || null;
      const { data: note } = noteId ? await admin.from("notes").select("id,title,content").eq("id", noteId).eq("user_id", userId).maybeSingle() : { data: null };
      const payload = source?.payload || {};
      let quote = String(payload.evidence_quote || "").trim();
      let context = String(payload.evidence_context || "").trim();
      let hasVerifiableQuote = !!note && exactQuoteExists(String(note.content || ""), quote);
      if (note && !hasVerifiableQuote) {
        const recovered = await recoverRelationshipEvidence({
          db: admin,
          userId,
          noteTitle: String(note.title || "Untitled"),
          noteContent: String(note.content || ""),
          personA: nameA,
          personB: nameB,
          label: row.label,
        });
        if (recovered) {
          quote = recovered.sourceQuote;
          context = recovered.sourceContext;
          hasVerifiableQuote = true;
        }
      }
      const adjudication = hasVerifiableQuote
        ? await adjudicateRelationship({ db: admin, userId, candidate: { personA: nameA, personB: nameB, label: row.label, sourceQuote: quote, sourceContext: context } })
        : {
            outcome: "review" as const, reason: note ? "No exact source quote could be verified in the source note" : "No source note could be recovered",
            canonicalLabel: canonicalLabel(row.label), inverseLabel: null, personAKind: "unclear" as const, personBKind: "unclear" as const,
            personallyRelevant: false, relationshipSupported: false, incidentalOrTransactional: false, fictionalOrRoleplay: false, confidence: 0,
          };
      const oldSnapshot = { ...row, source_note_id: noteId, evidence_quote: quote, evidence_context: context };
      let outcome = adjudication.outcome;
      const newLabel = adjudication.canonicalLabel || canonicalLabel(row.label);

      if (outcome === "keep") {
        const duplicate = await admin.from("contact_relationships").select("id,label").eq("user_id", userId).eq("pair_key", row.pair_key || "").neq("id", row.id).limit(1).maybeSingle();
        if (duplicate.data) {
          await admin.from("contact_relationships").delete().eq("id", row.id).eq("user_id", userId);
          outcome = "reject";
          adjudication.reason = `Semantically duplicate of relationship ${duplicate.data.id}`;
          counters.merged_count += 1;
        } else if (newLabel && newLabel !== canonicalLabel(row.label)) {
          await admin.from("contact_relationships").update({ label: newLabel }).eq("id", row.id).eq("user_id", userId);
          counters.relabeled_count += 1;
        } else counters.kept_count += 1;
        await admin.from("review_queue").update({ status: "removed", reviewed_at: new Date().toISOString() }).eq("user_id", userId).eq("suggestion_type", "adjudicate_relationship").eq("target_entity_id", row.id).in("status", ["pending", "pending_review"]);
      } else if (outcome === "reject") {
        await admin.from("contact_relationships").delete().eq("id", row.id).eq("user_id", userId);
        counters.removed_count += 1;
        await admin.from("review_queue").update({ status: "removed", reviewed_at: new Date().toISOString() }).eq("user_id", userId).eq("suggestion_type", "adjudicate_relationship").eq("target_entity_id", row.id).in("status", ["pending", "pending_review"]);
      } else {
        const suppressionKey = `relationship_evidence_review:${row.id}:${noteId || "no-note"}`;
        await admin.from("review_queue").upsert({
          user_id: userId, source_note_id: noteId, suggestion_type: "adjudicate_relationship", status: "pending_review",
          title: `Verify relationship: ${nameA} / ${nameB}`, description: adjudication.reason,
          target_entity_type: "relationship", target_entity_id: row.id, suppression_key: suppressionKey,
          payload: { relationship_id: row.id, person_a: nameA, person_b: nameB, label: row.label, evidence_quote: quote || null, evidence_context: context || null, adjudication_reason: adjudication.reason },
        }, { onConflict: "user_id,suppression_key" });
        counters.queued_count += 1;
      }

      if (quote && noteId) {
        await admin.from("relationship_evidence").upsert({
          user_id: userId, relationship_id: outcome === "reject" ? null : row.id, source_note_id: noteId,
          source_quote: quote, source_context: context || null, proposed_label: row.label, adjudicated_label: newLabel,
          outcome, reason: adjudication.reason, real_person_a: ["real_person", "public_person"].includes(adjudication.personAKind),
          real_person_b: ["real_person", "public_person"].includes(adjudication.personBKind), personally_relevant: adjudication.personallyRelevant,
          relationship_supported: adjudication.relationshipSupported, incidental_or_transactional: adjudication.incidentalOrTransactional,
          fictional_or_roleplay: adjudication.fictionalOrRoleplay, confidence: adjudication.confidence,
          adjudication_version: RELATIONSHIP_ADJUDICATION_VERSION, note_content_hash: noteContentHash(String(note?.content || "")),
        }, { onConflict: "user_id,source_note_id,proposed_label,note_content_hash,source_quote" });
      }
      await admin.from("relationship_repair_items").upsert({
        run_id: runId, user_id: userId, relationship_id: row.id, source_note_id: noteId, person_a: nameA, person_b: nameB,
        old_label: row.label, outcome, new_label: newLabel, reason: adjudication.reason, evidence_quote: quote || null,
        confidence: adjudication.confidence, snapshot: oldSnapshot,
      }, { onConflict: "run_id,relationship_id" });
    } catch (itemError) {
      counters.failed_count += 1;
      await admin.from("relationship_repair_items").upsert({
        run_id: runId, user_id: userId, relationship_id: row.id, person_a: nameA, person_b: nameB, old_label: row.label,
        outcome: "failed", reason: "Processing failed", snapshot: row, error: itemError instanceof Error ? itemError.message : String(itemError),
      }, { onConflict: "run_id,relationship_id" });
    }
  }

  const last = batch[batch.length - 1] as { id: string; created_at: string };
  const update: Record<string, unknown> = { cursor_created_at: last.created_at, cursor_id: last.id, processed_relationships: Number(run.processed_relationships) + batch.length };
  for (const [key, value] of Object.entries(counters)) update[key] = Number(run[key] || 0) + value;
  const { data: updated } = await admin.from("relationship_repair_runs").update(update).eq("id", runId).select("*").single();
  return updated;
}

async function runRelationshipRepairToCompletion(userId: string, runId: string, batchSize: number) {
  for (let batch = 0; batch < 500; batch += 1) {
    const run = await processRelationshipRepairBatch(userId, runId, batchSize);
    if (!run || ["completed", "failed"].includes(run.status)) return run;
  }
  await admin.from("relationship_repair_runs").update({ status: "failed", summary: { error: "Safety batch limit reached; resume by starting a new run" } }).eq("id", runId).eq("user_id", userId);
  throw new Error("Relationship repair exceeded its safety batch limit");
}

async function createRelationshipRepairRun(userId: string) {
  const { data: active } = await admin
    .from("relationship_repair_runs")
    .select("*")
    .eq("user_id", userId)
    .in("status", ["pending", "running"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (active) return active;
  const { count, error: countError } = await admin.from("contact_relationships").select("id", { count: "exact", head: true }).eq("user_id", userId);
  if (countError) throw countError;
  const { data: run, error } = await admin.from("relationship_repair_runs").insert({ user_id: userId, status: "pending", total_relationships: count || 0 }).select("*").single();
  if (error || !run) throw error || new Error("Could not create repair run");
  return run;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

async function authenticate(req: Request): Promise<{ userId: string | null; isService: boolean }> {
  // Nightly cron authenticates with a dedicated shared key, never the service role key.
  const cronKey = Deno.env.get("PROFILE_LINT_CRON_KEY") || "";
  const presented = req.headers.get("x-cron-key") || "";
  if (cronKey && presented && presented === cronKey) return { userId: null, isService: true };
  const auth = req.headers.get("Authorization");
  if (!auth) return { userId: null, isService: false };
  const token = auth.replace(/^Bearer\s+/i, "");
  if (serviceRoleKey && token === serviceRoleKey) return { userId: null, isService: true };
  const { data } = await admin.auth.getUser(token);
  return { userId: data.user?.id ?? null, isService: false };

}

const ROMANTIC = new Set(["wife", "husband", "spouse", "partner", "lover"]);

/** Coarse family of a canonical role — two labels in the same family are not a conflict. */
function bondFamily(label: string): string {
  if (ROMANTIC.has(label)) return "romantic";
  if (["mother", "father", "parent"].includes(label)) return "parent";
  if (["child", "son", "daughter"].includes(label)) return "child";
  if (["sibling", "brother", "sister"].includes(label)) return "sibling";
  if (["friend", "co-worker", "colleague", "manager", "employer", "employee"].includes(label)) return "social";
  return label;
}

function personPairKey(row: RelationshipRow): string {
  const a = `${row.source_type}:${row.source_id || "self"}`;
  const b = `${row.target_type}:${row.target_id || "self"}`;
  return [a, b].sort().join("|");
}

function normalizeName(name: string | null | undefined): string {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9\u00c0-\u024f\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function lintUser(userId: string, contactId: string | null, repair: boolean, queueReview: boolean) {
  const [relationshipsResult, entriesResult, contactsResult] = await Promise.all([
    admin.from("contact_relationships").select("id,user_id,source_type,source_id,target_type,target_id,label,custom_label,pair_key").eq("user_id", userId),
    admin.from("profile_entries").select("id,contact_id,category_id,label,value").eq("user_id", userId),
    admin.from("contacts").select("id,name").eq("user_id", userId),
  ]);
  if (relationshipsResult.error) throw relationshipsResult.error;
  if (entriesResult.error) throw entriesResult.error;
  if (contactsResult.error) throw contactsResult.error;

  const relationships = (relationshipsResult.data || []) as RelationshipRow[];
  const entries = (entriesResult.data || []) as Array<{ id: string; contact_id: string | null; category_id: string; label: string; value: string }>;
  const contacts = (contactsResult.data || []) as ContactRow[];
  const contactName = new Map(contacts.map((c) => [c.id, c.name || "Unnamed"]));

  const relationshipViolations: Violation[] = [];
  const seenPairs = new Set<string>();
  const byPersonPair = new Map<string, RelationshipRow[]>();

  for (const row of relationships) {
    if (contactId && row.source_id !== contactId && row.target_id !== contactId) continue;
    const label = canonicalLabel(row.label);
    if (isBlockedRelationshipLabel(label)) {
      relationshipViolations.push({ id: row.id, reason: "blocked_relationship_label", label: row.label });
      continue;
    }
    if ((row.source_type === row.target_type && row.source_id && row.source_id === row.target_id) || (row.source_type === "self" && row.target_type === "self")) {
      relationshipViolations.push({ id: row.id, reason: "self_relationship", label: row.label });
      continue;
    }
    if (row.pair_key && seenPairs.has(row.pair_key)) {
      relationshipViolations.push({ id: row.id, reason: "duplicate_pair", label: row.label });
      continue;
    }
    if (row.pair_key) seenPairs.add(row.pair_key);
    const key = personPairKey(row);
    const list = byPersonPair.get(key) || [];
    list.push(row);
    byPersonPair.set(key, list);
  }

  const profileViolations: Violation[] = [];
  for (const row of entries) {
    if (contactId && row.contact_id !== contactId) continue;
    const decision = profileValueDecision("", row.label, row.value);
    if (!decision.ok) profileViolations.push({ id: row.id, reason: decision.reason, label: row.label, value: row.value });
  }

  // ---- needs_review classification -------------------------------------
  const needsReview: Array<{ type: string; title: string; description: string; payload: Record<string, unknown>; suppression_key: string; target_entity_type?: string; target_entity_id?: string }> = [];

  // 1) Contradicting roles for the SAME person pair (different role families).
  //    Multiple partners live on different pairs and are never flagged.
  for (const [, rows] of byPersonPair) {
    const families = new Map<string, RelationshipRow>();
    for (const row of rows) families.set(bondFamily(canonicalLabel(row.label)), row);
    if (families.size < 2) continue;
    const involved = rows[0];
    const nameA = involved.source_type === "self" ? "You" : contactName.get(involved.source_id || "") || "Unknown";
    const nameB = involved.target_type === "self" ? "You" : contactName.get(involved.target_id || "") || "Unknown";
    const labels = [...new Set(rows.map((r) => canonicalLabel(r.label)))].sort();
    needsReview.push({
      type: "resolve_relationship_conflict",
      title: `Conflicting roles: ${nameA} & ${nameB}`,
      description: `Both "${labels.join('" and "')}" are recorded for the same two people. Pick the one that is right.`,
      payload: {
        options: rows.map((r) => ({ id: r.id, label: canonicalLabel(r.label), custom_label: r.custom_label })),
        person_a: nameA,
        person_b: nameB,
      },
      suppression_key: `relationship_conflict:${personPairKey(involved)}:${labels.join("|")}`,
    });
  }

  // 2) Duplicate people (same normalized name).
  const byName = new Map<string, ContactRow[]>();
  for (const c of contacts) {
    const key = normalizeName(c.name);
    if (!key) continue;
    if (contactId && c.id !== contactId) {
      // still needed to detect a duplicate of the linted contact
    }
    const list = byName.get(key) || [];
    list.push(c);
    byName.set(key, list);
  }
  for (const [key, group] of byName) {
    if (group.length < 2) continue;
    if (contactId && !group.some((c) => c.id === contactId)) continue;
    const ids = group.map((c) => c.id).sort();
    needsReview.push({
      type: "merge_duplicate_person",
      title: `Possible duplicate: ${group[0].name}`,
      description: `${group.length} people share the name "${group[0].name}". Merge them into one record if they are the same person.`,
      payload: {
        name: group[0].name,
        contact_ids: ids,
        keep_contact_id: ids[0],
        merge_contact_ids: ids.slice(1),
      },
      suppression_key: `duplicate_person:${key}:${ids.join("|")}`,
      target_entity_type: "contact",
      target_entity_id: ids[0],
    });
  }

  let queued = 0;
  if (queueReview && needsReview.length > 0) {
    const keys = needsReview.map((n) => n.suppression_key);
    const { data: existing } = await admin
      .from("review_queue")
      .select("suppression_key")
      .eq("user_id", userId)
      .in("suppression_key", keys);
    const seen = new Set((existing || []).map((r: { suppression_key: string | null }) => r.suppression_key || ""));
    const { data: suppressed } = await admin
      .from("ai_suggestion_suppressions")
      .select("suppression_key")
      .eq("user_id", userId)
      .in("suppression_key", keys);
    for (const s of suppressed || []) seen.add((s as { suppression_key: string | null }).suppression_key || "");
    const rows = needsReview
      .filter((n) => !seen.has(n.suppression_key))
      .map((n) => ({
        user_id: userId,
        suggestion_type: n.type,
        title: n.title,
        description: n.description,
        payload: n.payload,
        status: "pending_review",
        suppression_key: n.suppression_key,
        target_entity_type: n.target_entity_type ?? null,
        target_entity_id: n.target_entity_id ?? null,
      }));
    if (rows.length) {
      const { error } = await admin.from("review_queue").insert(rows);
      if (error) console.error("[profile-lint] queue insert failed", error);
      else queued = rows.length;
    }
  }

  const repaired = { relationships: 0, profile_entries: 0 };
  if (repair) {
    const relationshipIds = relationshipViolations
      .filter((v) => ["blocked_relationship_label", "self_relationship", "duplicate_pair"].includes(v.reason))
      .map((v) => v.id);
    if (relationshipIds.length) {
      const { error } = await admin.from("contact_relationships").delete().eq("user_id", userId).in("id", relationshipIds);
      if (error) throw error;
      repaired.relationships = relationshipIds.length;
    }
    const profileIds = profileViolations.map((v) => v.id);
    if (profileIds.length) {
      const { error } = await admin.from("profile_entries").delete().eq("user_id", userId).in("id", profileIds);
      if (error) throw error;
      repaired.profile_entries = profileIds.length;
    }
  }

  return {
    user_id: userId,
    violations: { relationships: relationshipViolations, profile_entries: profileViolations },
    needs_review: needsReview.length,
    queued,
    repaired,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);
  const { userId, isService } = await authenticate(req);
  if (!userId && !isService) return json({ error: "Unauthorized" }, 401);

  try {
    const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return json({ error: parsed.error.flatten().fieldErrors }, 400);
    const { action, contact_id: contactId, repair, queue_review: queueReview, scope, repair_run_id: repairRunId, repair_item_id: repairItemId, batch_size: batchSize } = parsed.data;

    if (action === "start_relationship_repair") {
      if (scope === "all_users") {
        if (!isService) return json({ error: "Forbidden" }, 403);
        const { data: profiles, error } = await admin.from("profiles").select("id");
        if (error) throw error;
        const ids = (profiles || []).map((profile: { id: string }) => profile.id);
        EdgeRuntime.waitUntil((async () => {
          for (const id of ids) {
            try {
              const run = await createRelationshipRepairRun(id);
              await runRelationshipRepairToCompletion(id, run.id, batchSize);
            } catch (repairError) {
              console.error("[profile-lint] relationship repair failed", id, repairError);
            }
          }
        })());
        return json({ ok: true, scope, users: ids.length, background: true });
      }
      if (!userId) return json({ error: "A user session is required" }, 401);
      const run = await createRelationshipRepairRun(userId);
      EdgeRuntime.waitUntil(runRelationshipRepairToCompletion(userId, run.id, batchSize).catch((error) => console.error("[profile-lint] relationship repair failed", error)));
      return json({ ok: true, run, background: true });
    }

    if (action === "continue_relationship_repair") {
      if (!repairRunId || (!userId && !isService)) return json({ error: "repair_run_id and authorization are required" }, 400);
      let repairUserId = userId;
      if (!repairUserId && isService) {
        const { data: runOwner, error: ownerError } = await admin.from("relationship_repair_runs").select("user_id").eq("id", repairRunId).single();
        if (ownerError || !runOwner) throw ownerError || new Error("Repair run not found");
        repairUserId = runOwner.user_id;
      }
      if (!repairUserId) return json({ error: "Repair owner unavailable" }, 400);
      const run = await processRelationshipRepairBatch(repairUserId, repairRunId, batchSize);
      if (run?.status !== "completed") EdgeRuntime.waitUntil(runRelationshipRepairToCompletion(repairUserId, repairRunId, batchSize).catch((error) => console.error("[profile-lint] continued repair failed", error)));
      return json({ ok: true, run });
    }

    if (action === "relationship_repair_status") {
      if (!userId || !repairRunId) return json({ error: "repair_run_id and a user session are required" }, 400);
      const [{ data: run, error: statusError }, { data: items }] = await Promise.all([
        admin.from("relationship_repair_runs").select("*").eq("id", repairRunId).eq("user_id", userId).single(),
        admin.from("relationship_repair_items").select("*").eq("run_id", repairRunId).eq("user_id", userId).order("created_at", { ascending: false }).limit(100),
      ]);
      if (statusError) throw statusError;
      return json({ ok: true, run, items: items || [] });
    }

    if (action === "rollback_relationship_repair_item") {
      if (!userId || !repairItemId) return json({ error: "repair_item_id and a user session are required" }, 400);
      const { data: item, error: itemError } = await admin.from("relationship_repair_items").select("*").eq("id", repairItemId).eq("user_id", userId).single();
      if (itemError || !item) throw itemError || new Error("Repair item not found");
      const snapshot = item.snapshot as Record<string, unknown>;
      const relationshipId = String(snapshot.id || item.relationship_id || "");
      if (!relationshipId) return json({ error: "No relationship snapshot is available" }, 409);
      const restored = {
        id: relationshipId, user_id: userId, source_type: snapshot.source_type, source_id: snapshot.source_id || null,
        target_type: snapshot.target_type, target_id: snapshot.target_id || null, label: snapshot.label,
        custom_label: snapshot.custom_label || null,
      };
      const { error: restoreError } = await admin.from("contact_relationships").upsert(restored);
      if (restoreError) throw restoreError;
      return json({ ok: true, relationship_id: relationshipId });
    }

    if (scope === "all_users") {
      if (!isService) return json({ error: "Forbidden" }, 403);
      const { data: profiles, error } = await admin.from("profiles").select("id");
      if (error) throw error;
      const ids = (profiles || []).map((p: { id: string }) => p.id);
      // Background: a full sweep must never block (or time out) the request.
      EdgeRuntime.waitUntil((async () => {
        for (const id of ids) {
          try {
            await lintUser(id, null, repair, queueReview);
          } catch (err) {
            console.error("[profile-lint] user sweep failed", id, err);
          }
        }
        console.log("[profile-lint] sweep complete", ids.length, "users");
      })());
      return json({ ok: true, scope, users: ids.length, background: true });
    }

    const result = await lintUser(userId!, contactId ?? null, repair, queueReview);
    return json({ ok: true, repair, ...result });
  } catch (error) {
    console.error("[profile-lint] failed", error);
    return json({ error: "Profile lint failed" }, 500);
  }
});
