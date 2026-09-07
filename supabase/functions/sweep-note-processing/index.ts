// Compatibility safety net: reconcile saved notes into the durable analysis queue.
// This endpoint never dispatches paid execution. Queue generation, quiet period,
// retry budget and allowance parking are authoritative in the database.
// POST { limit?: number = 10 } -> { scanned, triggered, ids }
// triggered counts accepted enqueue requests, not completed analysis.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createNoteAIJobs } from "../_shared/note-ai-jobs.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

/** Bound legacy reconciliation to older saves; database quiet time remains authoritative. */
const SETTLE_MS = 90_000;
/** A run marked "processing" that never finished is retried after this long. */
const STUCK_MS = 10 * 60_000;
/**
 * How many failed attempts a note gets before the sweep leaves it alone.
 *
 * Until 2026-09-03 there was no cap and no counter anywhere in the repo: a note
 * whose processing could never succeed was re-triggered on every single sweep,
 * paying for a metadata extraction each time. One account had 42 notes sitting
 * in exactly that state. Editing the note resets the count.
 */
const MAX_ATTEMPTS = 3;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const limit = Math.max(1, Math.min(25, Number(body?.limit ?? 10)));

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "Unauthorized" }, 401);
    const userId = userData.user.id;

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const cutoff = new Date(Date.now() - SETTLE_MS).toISOString();
    const { data: candidates, error: selErr } = await admin
      .from("notes")
      .select("id, updated_at, processing_status, embedding, processing_attempts")
      .eq("user_id", userId)
      .eq("is_trashed", false)
      .not("content", "is", null)
      .neq("content", "")
      .lt("updated_at", cutoff)
      .order("updated_at", { ascending: false })
      .limit(200);

    if (selErr) return json({ error: selErr.message }, 500);

    const now = Date.now();
    const needsWork = (row: any): boolean => {
      const status = row.processing_status as string | null;
      const age = now - new Date(row.updated_at).getTime();
      const attempts = Number(row.processing_attempts) || 0;
      // Three strikes. Every branch below that retries a note pays for a
      // metadata extraction before it can discover the note still fails, so an
      // unbounded retry is an unbounded bill. `process-note` counts the attempt
      // when it claims the note and resets it to 0 on success, so a note a human
      // has since edited gets a fresh three.
      const retriable = attempts < MAX_ATTEMPTS;

      if (status === "processing") return age > STUCK_MS && retriable;
      if (status === "failed") return retriable;
      if (status === "skipped_short" || status === "skipped_empty") return false;
      // Not capped, and correctly so: `process-note` turns this away on its own
      // balance check before contacting a provider, so a retry here costs no
      // tokens, and the note must come back the moment the allowance is topped up.
      if (status === "skipped_no_credits") return true;
      if (status === "processed") return !row.embedding && retriable;
      // null / unknown status: legacy note — process when it has no embedding.
      return !row.embedding && retriable;
    };

    const targets = (candidates || []).filter(needsWork).slice(0, limit);
    if (targets.length === 0) {
      return json({ scanned: candidates?.length ?? 0, triggered: 0, ids: [] });
    }

    const queuedIds: string[] = [];
    const jobs = createNoteAIJobs(admin);
    for (const note of targets) {
      const job = await jobs.enqueue(userId, note.id, "analysis", "automatic");
      if (job) queuedIds.push(note.id);
    }

    return json({
      scanned: candidates?.length ?? 0,
      triggered: queuedIds.length,
      ids: queuedIds,
    });
  } catch (err) {
    console.error("sweep-note-processing error:", err);
    return json({ error: err instanceof Error ? err.message : "Internal error" }, 500);
  }
});
