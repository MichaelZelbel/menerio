// The browser's way to add a fact, and the review queue's way to accept one
// (docs/plans/one-fact-store.md, 3.5).
//
//   write_fact            add a fact (the one add path); writeFact() decides
//   write_profile_entry   the old name, kept so a tab opened before go-live still saves
//   accept_profile_entry  accept one "add fact" suggestion from the review queue
//   bulk_profile_reviews  accept many
//
// Who writes decides who the fact belongs to: a user's call writes with a
// client built from their JWT, so the claim guards see a human (their own
// "It changed" may close their own earlier value). A trusted server call with
// the service role writes as a machine, for the user named in the body.
//
// The normalizer that used to live here (plan / backfill / apply / rollback /
// explode_bags) is retired: writeFact() canonicalizes and splits on the way in,
// and the unique live-value index makes exact duplicates impossible.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { z } from "npm:zod@3.23.8";
import { FactWritesPaused, writeFact, type FactInput, type WriteResult } from "../_shared/fact-store.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const Origin = z.enum(["user_manual", "ai_note", "ai_moment", "ai_lexicon", "review_queue", "import", "mcp", "api", "normalizer"]);
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const WriteFactSchema = z.object({
  contact_id: z.string().uuid().nullable().optional(),
  entity_id: z.string().uuid().nullable().optional(),
  category_slug: z.string().trim().min(1).max(80).nullable().optional(),
  label: z.string().trim().min(1).max(160),
  // An existing slot's key ("It changed"): used as is, never re-derived from the label.
  attribute: z.string().trim().min(1).max(120).regex(/^\S+$/).nullable().optional(),
  value: z.string().trim().min(1).max(2000),
  origin: Origin.optional(),
  evidence_quote: z.string().trim().max(2000).nullable().optional(),
  source_type: z.enum(["note", "moment", "manual", "ai", "lexicon"]).nullable().optional(),
  source_id: z.string().uuid().nullable().optional(),
  valid_from: Day.nullable().optional(),
  is_pinned: z.boolean().optional(),
});

// The shape write_profile_entry accepted before go-live.
const LegacyEntrySchema = z.object({
  contact_id: z.string().uuid().nullable().optional(),
  category_id: z.string().uuid().nullable().optional(),
  category_slug: z.string().trim().min(1).max(80).optional(),
  label: z.string().trim().min(1).max(160),
  value: z.string().trim().min(1).max(2000),
  linked_note_id: z.string().uuid().nullable().optional(),
  is_pinned: z.boolean().optional(),
  origin: Origin.optional(),
  evidence_quote: z.string().trim().max(2000).optional(),
});

const BulkProfileReviewSchema = z.object({
  decision: z.enum(["keep"]),
  review_ids: z.array(z.string().uuid()).min(1).max(500),
});

const RETIRED_ACTIONS = new Set(["plan", "backfill", "apply", "rollback", "explode_bags"]);

function toFactInput(p: z.infer<typeof WriteFactSchema>, fallbackOrigin: FactInput["origin"]): FactInput {
  const subject = p.entity_id
    ? { type: "entity" as const, id: p.entity_id }
    : p.contact_id
      ? { type: "contact" as const, id: p.contact_id }
      : { type: "self" as const, id: null };
  return {
    subject,
    label: p.label,
    attribute: p.attribute ?? null,
    value: p.value,
    origin: p.origin ?? fallbackOrigin,
    categorySlug: p.category_slug ?? null,
    evidenceQuote: p.evidence_quote ?? null,
    sourceType: p.source_type ?? null,
    sourceId: p.source_id ?? null,
    validFrom: p.valid_from ?? null,
    isPinned: p.is_pinned,
  };
}

async function legacyCategorySlug(db: any, userId: string, input: z.infer<typeof LegacyEntrySchema>): Promise<string | null> {
  if (input.category_slug) return input.category_slug;
  if (!input.category_id) return null;
  const { data } = await db.from("profile_categories").select("slug").eq("id", input.category_id).eq("user_id", userId).maybeSingle();
  return data?.slug ?? null;
}

/** The old response shape, for write_profile_entry and the review queue. */
function legacyOutcome(result: WriteResult) {
  const inserted = result.facts.find((f) => f.outcome === "inserted");
  const existing = result.facts.find((f) => f.outcome === "already_recorded" || f.outcome === "history_not_revived");
  if (inserted) return { ok: true, outcome: "inserted", entryId: inserted.claimId ?? null, claimId: inserted.claimId ?? null };
  if (existing) return { ok: true, outcome: "already_exists", entryId: existing.claimId ?? null, claimId: existing.claimId ?? null };
  const reason = result.facts.find((f) => f.reason)?.reason ?? result.facts[0]?.outcome ?? "rejected";
  return { ok: false, outcome: "rejected_duplicate", reason };
}

async function acceptProfileEntryReview(db: any, userId: string, reviewId: string) {
  const { data: row, error } = await db
    .from("review_queue")
    .select("id, user_id, suggestion_type, payload, source_note_id, status")
    .eq("id", reviewId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !row) return { ok: false, outcome: "rejected_duplicate", reason: "not_found" };
  if (row.suggestion_type !== "add_profile_entry") return { ok: false, outcome: "rejected_duplicate", reason: "wrong_suggestion_type" };
  const payload = row.payload || {};
  const parsed = LegacyEntrySchema.safeParse({
    contact_id: payload.contact_id ?? null,
    category_id: payload.category_id ?? null,
    category_slug: payload.category_slug,
    label: payload.label,
    value: payload.value,
    evidence_quote: String(payload.evidence_quote || "").trim() || undefined,
  });
  if (!parsed.success) return { ok: false, outcome: "rejected_duplicate", reason: "invalid_payload" };

  const slug = await legacyCategorySlug(db, userId, parsed.data);
  // Accepting from the queue is the user's decision about a machine's fact:
  // origin review_queue (no quote needed), written as a machine, like before.
  const result = await writeFact(db, userId, {
    subject: parsed.data.contact_id ? { type: "contact", id: parsed.data.contact_id } : { type: "self", id: null },
    label: parsed.data.label,
    value: parsed.data.value,
    origin: "review_queue",
    categorySlug: slug,
    evidenceQuote: parsed.data.evidence_quote ?? null,
    // The fact keeps where it came from: a moment, a note, or neither.
    sourceType: payload.moment_id ? "moment" : row.source_note_id ? "note" : "ai",
    sourceId: payload.moment_id ?? row.source_note_id ?? null,
  }, { isHuman: false });
  const outcome = legacyOutcome(result);
  if (outcome.ok) {
    const now = new Date().toISOString();
    await db.from("review_queue").update({
      status: "kept",
      target_entity_type: "claim",
      target_entity_id: outcome.claimId ?? null,
      applied_at: now,
      reviewed_at: now,
    }).eq("id", reviewId).eq("user_id", userId);
  }
  return outcome;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "");
    if (RETIRED_ACTIONS.has(action)) {
      return json({ ok: false, error: "retired", reason: "Profile cleanup now happens when a fact is added. Reload the page." }, 410);
    }

    // Trusted server-to-server calls (review-queue-bulk) present the service
    // role key and name the user in the body. Every write still filters on it.
    const bearer = authHeader.replace(/^Bearer\s+/i, "").trim();
    const isServiceCall = !!SERVICE_ROLE && bearer === SERVICE_ROLE;

    let userId: string;
    let writer: any;
    if (isServiceCall) {
      const claimed = String(body?.user_id || "");
      if (!z.string().uuid().safeParse(claimed).success) return json({ error: "user_id required for service-role calls" }, 400);
      userId = claimed;
      writer = admin;
    } else {
      const { data: { user }, error: authErr } = await createClient(SUPABASE_URL, ANON).auth.getUser(bearer);
      if (authErr || !user) return json({ error: "Unauthorized" }, 401);
      userId = user.id;
      // The user's own JWT: RLS applies and the claim guards see a human.
      writer = createClient(SUPABASE_URL, ANON, {
        global: { headers: { Authorization: `Bearer ${bearer}` } },
        auth: { persistSession: false },
      });
    }
    const isHuman = !isServiceCall;

    if (action === "write_fact") {
      const parsed = WriteFactSchema.safeParse(body?.fact || body);
      if (!parsed.success) return json({ error: parsed.error.flatten().fieldErrors }, 400);
      const input = toFactInput(parsed.data, isHuman ? "user_manual" : "api");
      if (isHuman && input.origin !== "user_manual") return json({ error: "a person's own write is user_manual" }, 400);
      const result = await writeFact(writer, userId, input, { isHuman });
      return json(result, result.ok ? 200 : 409);
    }

    if (action === "write_profile_entry") {
      const parsed = LegacyEntrySchema.safeParse(body?.entry || body);
      if (!parsed.success) return json({ error: parsed.error.flatten().fieldErrors }, 400);
      const slug = await legacyCategorySlug(admin, userId, parsed.data);
      const result = await writeFact(writer, userId, {
        subject: parsed.data.contact_id ? { type: "contact", id: parsed.data.contact_id } : { type: "self", id: null },
        label: parsed.data.label,
        value: parsed.data.value,
        origin: isHuman ? "user_manual" : (parsed.data.origin ?? "api"),
        categorySlug: slug,
        evidenceQuote: parsed.data.evidence_quote ?? null,
        sourceType: parsed.data.linked_note_id ? "note" : null,
        sourceId: parsed.data.linked_note_id ?? null,
        isPinned: parsed.data.is_pinned,
      }, { isHuman });
      const outcome = legacyOutcome(result);
      return json(outcome, outcome.ok ? 200 : 409);
    }

    if (action === "accept_profile_entry") {
      const reviewId = String(body?.review_id || "");
      if (!reviewId) return json({ error: "review_id required" }, 400);
      const result = await acceptProfileEntryReview(admin, userId, reviewId);
      return json(result, result.ok ? 200 : 409);
    }

    if (action === "bulk_profile_reviews") {
      const parsed = BulkProfileReviewSchema.safeParse(body);
      if (!parsed.success) return json({ error: parsed.error.flatten().fieldErrors }, 400);
      const summary = { processed: 0, inserted: 0, already_exists: 0, merged_list: 0, rejected_duplicate: 0, failed: 0 };
      for (const reviewId of parsed.data.review_ids) {
        summary.processed += 1;
        try {
          const result = await acceptProfileEntryReview(admin, userId, reviewId);
          if (result.ok && result.outcome === "inserted") summary.inserted += 1;
          else if (result.ok) summary.already_exists += 1;
          else summary.rejected_duplicate += 1;
        } catch (e) {
          if (e instanceof FactWritesPaused) throw e;
          summary.failed += 1;
          console.error("[normalize-profile] bulk review failed", reviewId, (e as Error).message);
        }
      }
      return json({ ok: true, summary });
    }

    return json({ error: `unknown action: ${action}` }, 400);
  } catch (e) {
    if (e instanceof FactWritesPaused) {
      return json({ ok: false, error: "paused", reason: "Menerio is updating. Try again in a few minutes." }, 503);
    }
    console.error("[normalize-profile] failed", (e as Error).message);
    return json({ error: "internal error" }, 500);
  }
});
