// Move a fact out of the display layer and into the fact store.
//
// profile_entries stopped being a fact store on 2026-09-01 (migration 093000)
// and became a display layer over `claims`. Nothing implemented the word
// "over": there were 272 profile entries and 20 claims, and all 20 had been
// moved by hand. This is the missing path.
//
// It is deliberately dull. All of the judgement lives in the pure planner in
// _shared/promote-entries.ts, which is unit-tested without a database; this
// file is the arms and legs — read rows, ask the planner, write what it says.
// No model runs anywhere in it. Anything the planner cannot decide comes back
// as a skip with a reason, never as a guess.
//
// WHAT IT WILL NOT DO:
//   * change the words of any value, hand-typed or otherwise
//   * close, delete or edit an existing claim — it only ever INSERTs
//   * merge two live answers to one question; that is a question for Michael
//   * promote a fact about a contact the user hid from AI
//
// The only column it ever writes on profile_entries is derived_from_claim_id,
// which is a link, not a value. world/menerio-bridge.md allows a background
// job to re-file a hand-edited fact and forbids it to change one.
//
// POST { dry_run?: boolean = true, include_contacts?: boolean = false,
//        limit?: number = 500, target_user_id?: string }
// → { planned, promoted, linked, skipped, skipped_by_reason, claims_embedded, … }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  planPromotions,
  type ContactVisibility,
  type EntryRow,
  type ExistingClaim,
} from "../_shared/promote-entries.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY")!;
const OPENROUTER_BASE = "https://openrouter.ai/api/v1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

/** Same text add_claim and backfill-claim-embeddings embed, so ranking agrees. */
function textFor(c: { attribute: string; value: string; evidence_quote: string | null }) {
  const triple = `${c.attribute}: ${c.value}`;
  return c.evidence_quote ? `${triple}\n${c.evidence_quote}` : triple;
}

async function getEmbedding(text: string): Promise<number[]> {
  const r = await fetch(`${OPENROUTER_BASE}/embeddings`, {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENROUTER_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "openai/text-embedding-3-small", input: text }),
  });
  if (!r.ok) throw new Error(`OpenRouter embeddings failed: ${r.status}`);
  const d = await r.json();
  return d.data[0].embedding;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    // Defaults to a DRY RUN. Every other job in this folder defaults to doing
    // the work; this one writes facts, and a fact written by accident is
    // expensive to find later.
    const dryRun = body?.dry_run === undefined ? true : Boolean(body.dry_run);
    const includeContacts = Boolean(body?.include_contacts ?? false);
    const limit = Math.max(1, Math.min(2000, Number(body?.limit ?? 500)));

    let userId: string | null = null;
    const bearer = authHeader.replace(/^Bearer\s+/i, "");
    if (bearer === SUPABASE_SERVICE_ROLE_KEY) {
      const targetUserId = String(body?.target_user_id || "").trim();
      if (!targetUserId) return json({ error: "target_user_id required for admin trigger" }, 400);
      userId = targetUserId;
    } else {
      const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: userData, error: userErr } = await userClient.auth.getUser();
      if (userErr || !userData?.user) return json({ error: "Unauthorized" }, 401);
      userId = userData.user.id;
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    let entryQuery = admin
      .from("profile_entries")
      .select("id, contact_id, label, value, origin, evidence_quote, linked_note_id, derived_from_claim_id, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: true })
      .limit(limit);
    if (!includeContacts) entryQuery = entryQuery.is("contact_id", null);

    const [entriesRes, claimsRes, contactsRes, rulesRes] = await Promise.all([
      entryQuery,
      admin
        .from("claims")
        .select("id, subject_type, subject_id, attribute, value, valid_to")
        .eq("user_id", userId),
      admin
        .from("contacts")
        .select("id, is_sensitive, ai_visibility")
        .eq("user_id", userId)
        .is("merged_into", null),
      admin.from("attribute_rules").select("attribute, cardinality"),
    ]);

    for (const [what, res] of Object.entries({ entries: entriesRes, claims: claimsRes, contacts: contactsRes, rules: rulesRes })) {
      if (res.error) return json({ error: `Could not read ${what}: ${res.error.message}` }, 500);
    }

    const rules: Record<string, { cardinality?: string | null }> = {};
    for (const r of (rulesRes.data || []) as any[]) rules[r.attribute] = { cardinality: r.cardinality };

    const plan = planPromotions(
      (entriesRes.data || []) as EntryRow[],
      (claimsRes.data || []) as ExistingClaim[],
      (contactsRes.data || []) as ContactVisibility[],
      rules,
    );

    // Group the skips so the report is readable. The DETAIL of a collision is
    // the useful part — it names both values — so those are listed in full and
    // the rest are counted.
    const byReason: Record<string, number> = {};
    for (const s of plan.skip) byReason[s.reason] = (byReason[s.reason] ?? 0) + 1;
    const collisions = plan.skip
      .filter((s) => s.reason === "collision-needs-michael")
      .map((s) => `${s.label}: ${s.detail}`);

    const summary = {
      scanned: (entriesRes.data || []).length,
      would_promote: plan.promote.length,
      would_link: plan.link.length,
      skipped: plan.skip.length,
      skipped_by_reason: byReason,
      collisions_for_michael: [...new Set(collisions)],
      include_contacts: includeContacts,
    };

    if (dryRun) return json({ dry_run: true, ...summary });

    let promoted = 0;
    let linked = 0;
    let embedded = 0;
    const failures: string[] = [];

    for (const p of plan.promote) {
      const { entry_ids, ...row } = p;
      const { data: inserted, error } = await admin
        .from("claims")
        .insert({ user_id: userId, ...row })
        .select("id, attribute, value, evidence_quote")
        .single();
      if (error || !inserted) {
        failures.push(`${p.attribute}: ${error?.message ?? "insert returned nothing"}`);
        continue;
      }
      promoted++;

      // Link every entry this claim now displays. Done AFTER the insert, so a
      // failed insert can never leave an entry pointing at a claim that does
      // not exist — which would hide the entry from world_claims and lose the
      // fact from the mirror entirely.
      const { data: relinked, error: linkErr } = await admin
        .from("profile_entries")
        .update({ derived_from_claim_id: inserted.id })
        .in("id", entry_ids)
        .select("id");
      if (linkErr) failures.push(`link ${p.attribute}: ${linkErr.message}`);
      else if ((relinked?.length ?? 0) < entry_ids.length) {
        // See the note in the link loop below: an update this table silently
        // cancels reports no error and changes nothing.
        failures.push(
          `link ${p.attribute}: ${entry_ids.length - (relinked?.length ?? 0)} of ${entry_ids.length} entries were not linked — a BEFORE UPDATE trigger cancelled the write`,
        );
      }

      // Best-effort, exactly like add_claim: a bad minute at the embedding
      // provider must not cost the user a perfectly good fact. The claim is
      // readable through get_claims either way, and backfill-claim-embeddings
      // sweeps up whatever failed here.
      try {
        const emb = await getEmbedding(textFor(inserted as any));
        const { error: embErr } = await admin.from("claims").update({ embedding: emb }).eq("id", inserted.id);
        if (!embErr) embedded++;
      } catch (_e) {
        // Counted by the `remaining` number backfill-claim-embeddings reports.
      }
    }

    // Entries whose fact a live claim already held in full. No new row: this
    // is the case migration 097000 exists for, where the mirror would
    // otherwise carry one fact twice.
    for (const l of plan.link) {
      // `.select()` is not cosmetic. profile_entries carries several BEFORE
      // UPDATE triggers (profile_entry_canonicalize among them) that RETURN
      // NULL to cancel a row rather than raise. A cancelled update comes back
      // with NO error and NO rows, so trusting `error` alone reports a write
      // that never happened — which is the exact failure this whole project
      // exists to catch. Counting the rows that came back is the only honest
      // way to know.
      const { data: updated, error } = await admin
        .from("profile_entries")
        .update({ derived_from_claim_id: l.claim_id })
        .eq("id", l.entry_id)
        .select("id");
      if (error) failures.push(`link ${l.label}: ${error.message}`);
      else if (!updated?.length) {
        failures.push(
          `link ${l.label} (entry ${l.entry_id}): a BEFORE UPDATE trigger cancelled the write, so the entry still shows beside its claim. The row is one a current quality guard would reject on insert.`,
        );
      } else linked++;
    }

    return json({ dry_run: false, ...summary, promoted, linked, claims_embedded: embedded, failures });
  } catch (err: unknown) {
    return json({ error: (err as Error).message }, 500);
  }
});
