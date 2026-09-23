// Profile reconciler.
//
// This is the single place that decides what a profile is allowed to contain.
// It runs over data that ALREADY exists (not only over new writes), so junk
// that was written before the write gates existed is removed instead of being
// hidden. It is idempotent and safe to run on a schedule.
//
// Relationships:
//   1. deterministic drop  — unusable label, missing/merged endpoint, self-edge
//   2. self-duplicate fold — a contact that is really the account owner is
//                            rewritten to "self" so a person never shows up
//                            as their own acquaintance
//   3. duplicate collapse  — one row per pair_key
//   4. evidence pass       — NEW automated rows need a verbatim note quote.
//                            Legacy rows (origin "unverified") and manual rows
//                            are kept and shown; they are never deleted for
//                            lacking evidence.
//
// The reconciler holds no opinion about which relationships a person may have
// at the same time. Concurrent bonds are valid data, not a conflict.
//
// Profile entries:
//   5. canonical placement — label + category corrected, blocked labels dropped
//   6. evidence pass       — AI-authored entries need a verbatim quote in their
//                            source note; manual and legacy entries are kept

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isValidCronRequest } from "../_shared/cron-auth.ts";
import {
  canonicalLabel,
  inverseLabel,
} from "../_shared/relationship-canonical.ts";

import { relationshipWriteDecision } from "../_shared/profile-integrity.ts";
import {
  canonicalProfileLabel,
  correctProfileCategory,
  isBlockedProfileLabel,
} from "../_shared/profile-canonical-schema.ts";
import {
  adjudicateRelationship,
  exactQuoteExists,
  noteContentHash,
  RELATIONSHIP_ADJUDICATION_VERSION,
} from "../_shared/relationship-adjudicator.ts";
import { selectAllRows } from "../_shared/paged-select.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

/** Rows adjudicated by the LLM per user per run. Keeps a sweep bounded. */
const MAX_LLM_ROWS_PER_USER = 4;

/** Origins that a sweep must never delete or re-judge. */
const TRUSTED_ORIGINS = new Set(["user_manual", "unverified"]);



type Rel = {
  id: string;
  user_id: string;
  source_type: string;
  source_id: string | null;
  target_type: string;
  target_id: string | null;
  label: string;
  origin: string | null;
  evidence_quote: string | null;
  evidence_note_id: string | null;
  pair_key: string | null;
  created_at: string;
};

type Contact = { id: string; name: string; merged_into: string | null };

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function personKey(type: string, id: string | null) {
  return type === "self" ? "self" : `contact:${id}`;
}

async function reconcileUser(db: any, userId: string) {
  const stats = {
    self_duplicates_folded: 0,
    relationships_checked: 0,
    relationships_deleted_invalid: 0,
    relationships_deleted_duplicate: 0,
    relationships_deleted_unevidenced: 0,
    relationships_verified: 0,
    entries_recategorized: 0,
    entries_deleted_blocked: 0,
    entries_deleted_unevidenced: 0,
    entries_marked_human: 0,
    entries_verified: 0,
    llm_calls: 0,
  };


  // Every list in this sweep is paged: an unpaged select stops at 1,000 rows
  // without saying so, and a contact missing from this map makes its
  // relationships look like dangling endpoints that step 1 deletes.
  const [contactRows, { data: profileRow }, aliasRows] = await Promise.all([
    selectAllRows<Contact>((from, to) =>
      db.from("contacts").select("id, name, merged_into").eq("user_id", userId).order("id").range(from, to)
    ),
    db.from("profiles").select("display_name").eq("id", userId).maybeSingle(),
    selectAllRows<{ alias: string }>((from, to) =>
      db.from("user_self_aliases").select("alias").eq("user_id", userId).order("alias").range(from, to)
    ),
  ]);
  const contacts = new Map<string, Contact>(contactRows.map((c) => [c.id, c]));
  const selfName = String(profileRow?.display_name || "").trim();

  // ---- 0. self-duplicate contacts ---------------------------------------
  // A contact record that is really the account owner turns every fact about
  // the owner into a fact about a stranger ("Yumei — partner of michael").
  // Fold those records into "self" before anything else looks at the graph.
  // Letters of any script. `[^a-z]` turned a name written in Chinese, Cyrillic
  // or Greek into "", and "" then matched every such contact: each one was
  // deleted and its facts moved onto the owner.
  const normalizeName = (value: string) => value.toLowerCase().normalize("NFKC").replace(/[^\p{L}\p{N}]/gu, "");
  const selfNames = new Set<string>();
  const selfDisplay = normalizeName(selfName);
  if (selfDisplay.length >= 2) selfNames.add(selfDisplay);
  for (const row of aliasRows) {
    const alias = String(row.alias || "").trim();
    const normalized = normalizeName(alias);
    // Only full-name aliases fold a contact. A first name ("Mike") is shared
    // with friends: folding on it deleted a real friend called Mike and filed
    // his facts under the owner, with no review. Pronouns are not names either.
    if (normalized.length >= 4 && /\s/.test(alias)) selfNames.add(normalized);
  }
  const selfDuplicateIds = new Set<string>();
  for (const contact of contacts.values()) {
    const key = normalizeName(contact.name || "");
    if (key && selfNames.has(key)) selfDuplicateIds.add(contact.id);
  }
  if (selfDuplicateIds.size) {
    const ids = [...selfDuplicateIds];
    const dupRels = await selectAllRows<Rel>((from, to) =>
      db
        .from("contact_relationships")
        .select("id, source_type, source_id, target_type, target_id")
        .eq("user_id", userId)
        .or(`source_id.in.(${ids.join(",")}),target_id.in.(${ids.join(",")})`)
        .order("id")
        .range(from, to)
    );
    for (const rel of dupRels) {
      const sourceIsSelf = rel.source_type === "contact" && rel.source_id && selfDuplicateIds.has(rel.source_id);
      const targetIsSelf = rel.target_type === "contact" && rel.target_id && selfDuplicateIds.has(rel.target_id);
      if (sourceIsSelf && targetIsSelf) {
        await db.from("contact_relationships").delete().eq("id", rel.id);
        continue;
      }
      // The other endpoint is already "self" — this row says "me → me".
      if ((sourceIsSelf && rel.target_type === "self") || (targetIsSelf && rel.source_type === "self")) {
        await db.from("contact_relationships").delete().eq("id", rel.id);
        continue;
      }
      const patch = sourceIsSelf
        ? { source_type: "self", source_id: null }
        : { target_type: "self", target_id: null };
      const { error } = await db.from("contact_relationships").update(patch).eq("id", rel.id);
      // A unique pair collision means the correct row already exists.
      if (error) await db.from("contact_relationships").delete().eq("id", rel.id);
    }
    // Facts recorded against the duplicate belong on the owner's own profile.
    const dupEntries = await selectAllRows<{ id: string; label: string; value: string }>((from, to) =>
      db
        .from("profile_entries")
        .select("id, label, value")
        .eq("user_id", userId)
        .in("contact_id", ids)
        .order("id")
        .range(from, to)
    );
    for (const entry of dupEntries) {
      const { error } = await db.from("profile_entries").update({ contact_id: null }).eq("id", entry.id);
      if (error) await db.from("profile_entries").delete().eq("id", entry.id);
    }
    await db.from("contacts").delete().in("id", ids);
    for (const id of ids) contacts.delete(id);
    stats.self_duplicates_folded = ids.length;
  }

  const nameOf = (type: string, id: string | null): string | null => {
    if (type === "self") return selfName || "the account owner";
    const contact = id ? contacts.get(id) : null;
    if (!contact || (contact.merged_into && contact.merged_into !== contact.id)) return null;
    return contact.name;
  };

  const relationships = await selectAllRows<Rel>((from, to) =>
    db
      .from("contact_relationships")
      .select("id, user_id, source_type, source_id, target_type, target_id, label, origin, evidence_quote, evidence_note_id, pair_key, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to)
  );
  stats.relationships_checked = relationships.length;

  const drop = async (ids: string[]) => {
    for (let i = 0; i < ids.length; i += 100) {
      await db.from("contact_relationships").delete().in("id", ids.slice(i, i + 100));
    }
  };


  // ---- 1. deterministic drop -------------------------------------------
  const invalid: string[] = [];
  const surviving: Rel[] = [];
  for (const rel of relationships) {
    // A relationship explicitly entered by the user is authoritative. Automated
    // reconciliation may normalize or deduplicate it, but never delete it.
    if (rel.origin === "user_manual") {
      const label = canonicalLabel(rel.label);
      const decision = relationshipWriteDecision({
        userId,
        sourceType: rel.source_type as "contact" | "self",
        sourceId: rel.source_id,
        targetType: rel.target_type as "contact" | "self",
        targetId: rel.target_id,
        label,
      });
      surviving.push({ ...rel, label, pair_key: decision.ok ? decision.pairKey : rel.pair_key });
      continue;
    }
    const label = canonicalLabel(rel.label);
    const decision = relationshipWriteDecision({
      userId,
      sourceType: rel.source_type as "contact" | "self",
      sourceId: rel.source_id,
      targetType: rel.target_type as "contact" | "self",
      targetId: rel.target_id,
      label,
    });
    const endpointsExist = nameOf(rel.source_type, rel.source_id) && nameOf(rel.target_type, rel.target_id);
    if (!decision.ok || !endpointsExist) {
      invalid.push(rel.id);
      continue;
    }
    surviving.push({ ...rel, label, pair_key: decision.pairKey });
  }
  if (invalid.length) {
    await drop(invalid);
    stats.relationships_deleted_invalid = invalid.length;
  }

  // ---- 2. duplicate collapse -------------------------------------------
  const byPair = new Map<string, Rel>();
  const duplicates: string[] = [];
  for (const rel of surviving) {
    const key = rel.pair_key || `manual:${rel.id}`;
    const existing = byPair.get(key);
    if (!existing) {
      byPair.set(key, rel);
      continue;
    }
    // Keep the row that already carries evidence, else the older one.
    const keep = existing.evidence_quote ? existing : rel.evidence_quote ? rel : existing;
    const discard = keep === existing ? rel : existing;
    byPair.set(key, keep);
    duplicates.push(discard.id);
  }
  if (duplicates.length) {
    await drop(duplicates);
    stats.relationships_deleted_duplicate = duplicates.length;
  }

  // ---- 3. evidence pass -------------------------------------------------
  const candidates = [...byPair.values()];
  const verified: Rel[] = [];
  let llmBudget = MAX_LLM_ROWS_PER_USER;
  // If the judge itself is unreachable (credit limit, network, 5xx) we must NOT
  // read that as "no evidence" — nothing gets deleted and the run is retried.
  let judgeDown: unknown = null;
  const judgeUnavailable = (error: unknown) => { judgeDown = judgeDown ?? error; };

  // A row is already judged when the judge kept it at the current adjudication
  // version: recorded by this reconciler against the relationship id, or by
  // process-note for the same quote from the same note before the row existed.
  // Those are not re-billed.
  //
  // This test used to be `|| !!rel.evidence_quote`. The database refuses any
  // automated row without a quote, so that shortcut covered every automated
  // row, the "no quote" branch below covered the rest, and nothing after the
  // two `continue`s ever ran.
  const priorKeeps = await selectAllRows<{ relationship_id: string | null; source_note_id: string | null; source_quote: string }>(
    (from, to) =>
      db
        .from("relationship_evidence")
        .select("relationship_id, source_note_id, source_quote")
        .eq("user_id", userId)
        .eq("adjudication_version", RELATIONSHIP_ADJUDICATION_VERSION)
        .eq("outcome", "keep")
        .order("id")
        .range(from, to),
  );
  const quoteKey = (noteId: string | null, quote: string | null) => `${noteId || ""}|${String(quote || "").trim()}`;
  const judgedIds = new Set(priorKeeps.map((e) => e.relationship_id).filter(Boolean));
  const judgedQuotes = new Set(
    priorKeeps.filter((e) => e.source_note_id).map((e) => quoteKey(e.source_note_id, e.source_quote)),
  );

  for (const rel of candidates) {
    // Manual rows and legacy rows are the user's own history. They are shown
    // as-is and are never deleted or re-judged by a sweep; the user confirms or
    // removes them in the UI.
    if (TRUSTED_ORIGINS.has(String(rel.origin || ""))) {
      verified.push(rel);
      continue;
    }
    if (judgedIds.has(rel.id) || (rel.evidence_note_id && judgedQuotes.has(quoteKey(rel.evidence_note_id, rel.evidence_quote)))) {
      verified.push(rel);
      continue;
    }
    if (judgeDown) break;

    const personA = nameOf(rel.source_type, rel.source_id)!;
    const personB = nameOf(rel.target_type, rel.target_id)!;

    // A newly written automated row must carry its source. Without one there is
    // nothing to judge, so it is quarantined as legacy rather than deleted.
    if (!rel.evidence_note_id || !rel.evidence_quote) {
      await db.from("contact_relationships").update({ origin: "unverified" }).eq("id", rel.id);
      verified.push({ ...rel, origin: "unverified" });
      continue;
    }

    const { data: sourceNote } = await db
      .from("notes")
      .select("id, title, content")
      .eq("id", rel.evidence_note_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (!sourceNote || !exactQuoteExists(String(sourceNote.content || ""), rel.evidence_quote)) {
      await db.from("contact_relationships").update({ origin: "unverified" }).eq("id", rel.id);
      verified.push({ ...rel, origin: "unverified" });
      continue;
    }


    if (llmBudget <= 0) break;
    llmBudget -= 1;
    stats.llm_calls += 1;
    const verdict = await adjudicateRelationship({
      db,
      userId,
      candidate: {
        personA,
        personB,
        label: rel.label,
        sourceQuote: rel.evidence_quote,
        sourceContext: rel.evidence_quote,
      },
      onJudgeUnavailable: judgeUnavailable,
    });

    if (judgeDown) break;
    if (verdict.outcome === "reject") {
      await drop([rel.id]);
      stats.relationships_deleted_unevidenced += 1;
      continue;
    }
    if (verdict.outcome !== "keep") {
      // "review" means the judge could not decide, which is not a finding that
      // the row is false: quarantine it for the user, never delete it.
      await db.from("contact_relationships").update({ origin: "unverified" }).eq("id", rel.id);
      verified.push({ ...rel, origin: "unverified" });
      continue;
    }

    const finalLabel = verdict.canonicalLabel || rel.label;
    await db.from("contact_relationships").update({ label: finalLabel, origin: "ai_note" }).eq("id", rel.id);
    // note_content_hash is NOT NULL and part of the unique key. Without it this
    // write was refused, unseen, and the row would be re-judged every sweep.
    const { error: evidenceError } = await db.from("relationship_evidence").upsert({
      user_id: userId,
      relationship_id: rel.id,
      source_note_id: sourceNote.id,
      source_quote: rel.evidence_quote,
      source_context: rel.evidence_quote,
      proposed_label: rel.label,
      adjudicated_label: finalLabel,
      outcome: "keep",
      reason: verdict.reason,
      real_person_a: verdict.personAKind === "real_person",
      real_person_b: verdict.personBKind === "real_person",
      personally_relevant: verdict.personallyRelevant,
      relationship_supported: verdict.relationshipSupported,
      incidental_or_transactional: verdict.incidentalOrTransactional,
      fictional_or_roleplay: verdict.fictionalOrRoleplay,
      confidence: verdict.confidence,
      adjudication_version: RELATIONSHIP_ADJUDICATION_VERSION,
      note_content_hash: noteContentHash(String(sourceNote.content || "")),
    }, { onConflict: "user_id,source_note_id,proposed_label,note_content_hash,source_quote" });
    if (evidenceError) console.error("[profile-reconcile] evidence write failed", rel.id, evidenceError.message);
    verified.push({ ...rel, label: finalLabel, origin: "ai_note" });
    stats.relationships_verified += 1;
  }

  if (judgeDown) {
    // Deleting here would destroy real data because of an outage. Stop the run.
    throw new Error(`judge unavailable — reconciliation aborted without deletions: ${String((judgeDown as Error)?.message || judgeDown)}`);
  }

  // Concurrent bonds (a spouse and a partner at the same time) are valid data.
  // The reconciler deliberately holds no opinion about relationship structure.



  // ---- 5 + 6. profile entries ------------------------------------------
  const categories = await selectAllRows<{ id: string; slug: string; contact_id: string | null }>((from, to) =>
    db.from("profile_categories").select("id, slug, contact_id").eq("user_id", userId).order("id").range(from, to)
  );
  const categoryById = new Map(categories.map((c) => [c.id, c]));
  const categoryFor = (slug: string, contactId: string | null) =>
    categories.find((c) => c.slug === slug && (c.contact_id ?? null) === (contactId ?? null));

  const entries = await selectAllRows<{
    id: string; category_id: string; contact_id: string | null; label: string; value: string;
    origin: string | null; evidence_quote: string | null; linked_note_id: string | null;
  }>((from, to) =>
    db
      .from("profile_entries")
      .select("id, category_id, contact_id, label, value, origin, evidence_quote, linked_note_id")
      .eq("user_id", userId)
      .order("id")
      .range(from, to)
  );

  const noteCache = new Map<string, string | null>();
  const loadNote = async (noteId: string): Promise<string | null> => {
    if (noteCache.has(noteId)) return noteCache.get(noteId)!;
    const { data, error } = await db.from("notes").select("content").eq("id", noteId).eq("user_id", userId).maybeSingle();
    if (error) throw new Error(`Could not verify profile-entry evidence: ${error.message}`);
    const content = data ? String(data.content || "") : null;
    noteCache.set(noteId, content);
    return content;
  };

  const entriesToDelete: string[] = [];
  for (const entry of entries) {
    const currentSlug = categoryById.get(entry.category_id)?.slug || "";
    const label = canonicalProfileLabel(currentSlug, entry.label);

    if (!label || isBlockedProfileLabel(label) || !String(entry.value || "").trim()) {
      entriesToDelete.push(entry.id);
      stats.entries_deleted_blocked += 1;
      continue;
    }

    const patch: Record<string, unknown> = {};

    // Section placement: a line lives in exactly one canonical section.
    const targetSlug = correctProfileCategory(label, currentSlug);
    if (targetSlug && targetSlug !== currentSlug) {
      const target = categoryFor(targetSlug, entry.contact_id ?? null);
      if (target) {
        patch.category_id = target.id;
        stats.entries_recategorized += 1;
      }
    }
    if (label !== entry.label) patch.label = label;

    // Provenance: manual and legacy entries are the user's own history and are
    // kept. Only a NEW automated entry has to prove itself against its note.
    const trustedEntry = entry.origin === "user_manual" || entry.origin === "unverified";
    if (trustedEntry || !!entry.evidence_quote) {
      // kept as-is
    } else if (!entry.linked_note_id) {
      patch.origin = "unverified";
    } else {
      const content = await loadNote(entry.linked_note_id);
      // A missing source row is not proof that the fact is false.
      if (content === null) continue;
      const quote = exactQuoteExists(content, entry.value) ? entry.value : null;
      if (!quote) {
        patch.origin = "unverified";
      } else {
        patch.origin = "ai_note";
        patch.evidence_quote = quote;
        stats.entries_verified += 1;
      }
    }


    if (Object.keys(patch).length) {
      await db.from("profile_entries").update(patch).eq("id", entry.id);
    }
  }

  for (let i = 0; i < entriesToDelete.length; i += 100) {
    await db.from("profile_entries").delete().in("id", entriesToDelete.slice(i, i + 100));
  }

  return stats;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const service = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    const body = await req.json().catch(() => ({}));
    const scope = body?.scope === "all" ? "all" : "me";
    // The scheduled sweep authenticates with the scheduler's shared key
    // (x-cron-key, held only in the database — _shared/cron-auth.ts). The
    // body's {"cron": ...} marker is routing information and grants nothing:
    // this endpoint deletes contacts and relationships, so service trust must
    // never hinge on anything a stranger can type into a request body.
    const bearer = authHeader.replace(/^Bearer\s+/i, "").trim();
    const isServiceCall = (!!SUPABASE_SERVICE_ROLE_KEY && bearer === SUPABASE_SERVICE_ROLE_KEY) ||
      (body?.cron === "profile-reconcile" && (await isValidCronRequest(req)));

    /** Run one user in the background and record the outcome. */
    const runTracked = async (targetUserId: string) => {
      const { data: runRow } = await service
        .from("profile_reconcile_runs")
        .insert({ user_id: targetUserId, status: "running" })
        .select("id")
        .maybeSingle();
      try {
        const stats = await reconcileUser(service, targetUserId);
        console.log("[profile-reconcile]", targetUserId, JSON.stringify(stats));
        if (runRow?.id) {
          await service.from("profile_reconcile_runs")
            .update({ status: "completed", stats, finished_at: new Date().toISOString() })
            .eq("id", runRow.id);
        }
        const { count: remaining } = await service
          .from("contact_relationships")
          .select("id", { count: "exact", head: true })
          .eq("user_id", targetUserId)
          .eq("origin", "unverified");
        if ((remaining || 0) > 0) console.log("[profile-reconcile] pending quarantined rows", targetUserId, remaining);
      } catch (error) {
        console.error("[profile-reconcile] user failed", targetUserId, error);
        if (runRow?.id) {
          await service.from("profile_reconcile_runs")
            .update({ status: "failed", error: String((error as Error).message || error), finished_at: new Date().toISOString() })
            .eq("id", runRow.id);
        }
      }
    };

    // deno-lint-ignore no-explicit-any
    const background = (task: Promise<unknown>) => (globalThis as any).EdgeRuntime?.waitUntil?.(task);

    if (scope === "all") {
      if (!isServiceCall) return jsonResponse({ error: "forbidden" }, 403);
      const { data: users } = await service.from("profiles").select("id").limit(500);
      const run = async () => {
        for (const user of (users || []) as Array<{ id: string }>) await runTracked(user.id);
      };
      background(run());
      return jsonResponse({ started: true, users: users?.length || 0 });
    }

    let userId: string | null = null;
    if (isServiceCall && typeof body?.userId === "string") {
      userId = body.userId;
    } else {
      const authed = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: authHeader } },
        auth: { persistSession: false },
      });
      const { data } = await authed.auth.getUser();
      userId = data.user?.id ?? null;
    }
    if (!userId) return jsonResponse({ error: "unauthorized" }, 401);

    background(runTracked(userId));
    return jsonResponse({ started: true });
  } catch (error) {
    console.error("[profile-reconcile] failed", error);
    return jsonResponse({ error: String((error as Error).message || error) }, 500);
  }
});
