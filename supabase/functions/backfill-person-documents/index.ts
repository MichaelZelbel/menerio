// Re-embed person_documents with real vectors.
//
// Every vector previously in person_documents.embedding was invented by a chat
// model (see migration 20260817140000). That migration drops the column and
// recreates it at 1536 dimensions, so after it runs every long-term document has
// no embedding and match_person_documents returns nothing for it. This function
// fills them back in through getEmbeddingWithCredits, the same path process-note
// already uses for note chunks.
//
// Mirrors backfill-embeddings: per-request and user-scoped, uses the caller's JWT
// to derive user_id, charges that user's AI credits, and only touches their own
// rows. A service-role caller must name the user explicitly.
//
// POST { limit?: number = 25, dry_run?: boolean = false, target_user_id?: string }
// → { scanned, updated, skipped, failures, balance_remaining }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getEmbeddingWithCredits } from "../_shared/llm-credits.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY")!;

/** Matches the cap embed-document applies, so a backfilled vector equals a live one. */
const MAX_EMBED_CHARS = 8000;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const limit = Math.max(1, Math.min(100, Number(body?.limit ?? 25)));
    const dryRun = Boolean(body?.dry_run ?? false);

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

    // Only long-term documents are embedded at all, and only those still missing
    // a vector. Re-running this is safe and picks up where it stopped.
    const { data: candidates, error: selErr } = await admin
      .from("person_documents")
      .select("id, title, content")
      .eq("user_id", userId)
      .eq("memory_type", "long_term")
      .is("embedding", null)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (selErr) return json({ error: selErr.message }, 500);

    if (!candidates || candidates.length === 0) {
      return json({ scanned: 0, updated: 0, skipped: 0, failures: 0, message: "No documents need embeddings." });
    }

    if (dryRun) {
      return json({
        scanned: candidates.length,
        updated: 0,
        skipped: candidates.length,
        failures: 0,
        dry_run: true,
        ids: candidates.map((d) => d.id),
      });
    }

    let updated = 0;
    let skipped = 0;
    let failures = 0;
    let balance_remaining: number | null = null;
    let stopped_reason: string | null = null;

    for (const doc of candidates) {
      const text = `${doc.title ?? ""}\n\n${doc.content ?? ""}`.trim();
      if (!text) { skipped += 1; continue; }
      try {
        const { embedding, credits } = await getEmbeddingWithCredits(
          admin, OPENROUTER_API_KEY, userId!, "backfill-person-documents",
          text.slice(0, MAX_EMBED_CHARS),
        );
        balance_remaining = credits?.remaining_credits ?? balance_remaining;

        const { error: updErr } = await admin
          .from("person_documents")
          .update({
            embedding: JSON.stringify(embedding),
            embedding_updated_at: new Date().toISOString(),
          })
          .eq("id", doc.id)
          .eq("user_id", userId);

        if (updErr) {
          console.warn("person_documents embedding update failed", doc.id, updErr.message);
          failures += 1;
        } else {
          updated += 1;
        }
      } catch (err) {
        const msg = (err as Error).message || String(err);
        console.warn("backfill-person-documents failed", doc.id, msg);
        failures += 1;
        // Stop rather than burn the rest of the batch against the same wall, and
        // report WHICH wall: an unreadable allowance is worth retrying, a spent
        // quota is not.
        if (msg === "BALANCE_UNAVAILABLE") { stopped_reason = "balance_unavailable"; break; }
        if (msg === "INSUFFICIENT_CREDITS" || msg === "NO_ACTIVE_PERIOD" || msg.toLowerCase().includes("insufficient")) {
          stopped_reason = "insufficient_credits";
          break;
        }
      }
    }

    return json({
      scanned: candidates.length,
      updated,
      skipped,
      failures,
      balance_remaining,
      stopped_reason,
      remaining_hint: "Re-run until updated is 0; each call handles at most `limit` documents.",
    });
  } catch (err) {
    console.error("backfill-person-documents error", err);
    return json({ error: (err as Error).message }, 500);
  }
});
