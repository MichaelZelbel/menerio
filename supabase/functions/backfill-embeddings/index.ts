// Backfill embeddings for notes that are missing one.
// Per-request user-scoped: uses the caller's JWT to derive user_id, charges the
// caller's AI credits, and only touches that user's own notes.
//
// POST { limit?: number = 25, dry_run?: boolean = false }
// → { scanned, updated, skipped, failures, balance_remaining }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getEmbeddingWithCredits } from "../_shared/llm-credits.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY")!;

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

    // Resolve caller. Two paths:
    //  1. Normal end-user JWT  → user_id derived from token.
    //  2. Service-role token   → admin-triggered backfill; must pass target_user_id.
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

    // Service-role client for the actual backfill writes (bypasses RLS).
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: candidates, error: selErr } = await admin
      .from("notes")
      .select("id, title, content")
      .eq("user_id", userId)
      .eq("is_trashed", false)
      .is("embedding", null)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (selErr) return json({ error: selErr.message }, 500);

    if (!candidates || candidates.length === 0) {
      return json({ scanned: 0, updated: 0, skipped: 0, failures: 0, message: "No notes need embeddings." });
    }

    if (dryRun) {
      return json({
        scanned: candidates.length,
        updated: 0,
        skipped: candidates.length,
        failures: 0,
        dry_run: true,
        ids: candidates.map((n) => n.id),
      });
    }

    let updated = 0;
    let skipped = 0;
    let failures = 0;
    let balance_remaining: number | null = null;

    for (const note of candidates) {
      const text = `${note.title ?? ""}\n\n${note.content ?? ""}`.trim();
      if (!text) {
        skipped += 1;
        continue;
      }
      try {
        const { embedding, credits } = await getEmbeddingWithCredits(
          admin,
          OPENROUTER_API_KEY,
          userId,
          "backfill-embeddings",
          text.slice(0, 8000), // guard against very large notes
        );
        balance_remaining = credits?.remaining_credits ?? balance_remaining;

        const { error: updErr } = await admin
          .from("notes")
          .update({ embedding })
          .eq("id", note.id)
          .eq("user_id", userId);

        if (updErr) {
          console.warn("update failed", note.id, updErr.message);
          failures += 1;
        } else {
          updated += 1;
        }
      } catch (err) {
        console.warn("embedding failed", note.id, (err as Error).message);
        failures += 1;
        // If we hit an insufficient-credits error, stop early.
        if (String((err as Error).message).toLowerCase().includes("insufficient")) break;
      }
    }

    return json({
      scanned: candidates.length,
      updated,
      skipped,
      failures,
      balance_remaining,
    });
  } catch (err) {
    console.error("backfill-embeddings error", err);
    return json({ error: (err as Error).message }, 500);
  }
});
