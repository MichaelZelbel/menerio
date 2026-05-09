// Backfill chunk embeddings for notes that are missing one.
// Per-request user-scoped: uses the caller's JWT to derive user_id, charges the
// caller's AI credits, and only touches that user's own notes.
//
// POST { limit?: number = 25, dry_run?: boolean = false }
// → { scanned, updated, skipped, failures, balance_remaining }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { embedAndStoreNoteChunks } from "../_shared/chunk-embeddings.ts";

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

    // Notes that are still missing a note-level embedding OR have no chunks yet.
    const { data: candidates, error: selErr } = await admin
      .from("notes")
      .select("id, title, content, embedding")
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
    let chunks_created = 0;
    let truncated_notes = 0;
    let balance_remaining: number | null = null;
    let stop = false;

    for (const note of candidates) {
      if (stop) break;
      const text = `${note.title ?? ""}\n\n${note.content ?? ""}`.trim();
      if (!text) { skipped += 1; continue; }
      try {
        const result = await embedAndStoreNoteChunks(
          admin, OPENROUTER_API_KEY, userId!, note.id, note.title ?? null, text, "backfill-embeddings",
        );
        balance_remaining = result.remainingCredits ?? balance_remaining;
        chunks_created += result.chunkCount;
        if (result.truncated) truncated_notes += 1;
        failures += result.failures;

        if (result.firstChunkEmbedding) {
          const { error: updErr } = await admin
            .from("notes")
            .update({ embedding: result.firstChunkEmbedding })
            .eq("id", note.id)
            .eq("user_id", userId);
          if (updErr) {
            console.warn("note embedding update failed", note.id, updErr.message);
            failures += 1;
          } else {
            updated += 1;
          }
        } else {
          skipped += 1;
        }

        if (result.insufficientCredits) { stop = true; break; }
      } catch (err) {
        console.warn("backfill failed", note.id, (err as Error).message);
        failures += 1;
        if (String((err as Error).message).toLowerCase().includes("insufficient")) break;
      }
    }

    return json({
      scanned: candidates.length,
      updated,
      skipped,
      failures,
      chunks_created,
      truncated_notes,
      balance_remaining,
    });
  } catch (err) {
    console.error("backfill-embeddings error", err);
    return json({ error: (err as Error).message }, 500);
  }
});
