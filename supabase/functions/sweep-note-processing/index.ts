// Safety net for AI note processing.
//
// The web editor schedules `process-note` on a client-side timer, which is lost
// when the user navigates away or closes the tab. This sweep finds the caller's
// notes that have content but were never indexed (no embedding / no processing
// status / a failed or stuck run) and runs `process-note` on them.
//
// POST { limit?: number = 10 } → { scanned, triggered, ids }
// Idempotency lives in `process-note` itself (content-hash check), so a note
// that is already processed for its current content version is never charged.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

/** Notes must be settled for this long before the sweep touches them, so we
 *  never race the editor's own 10s auto-process timer. */
const SETTLE_MS = 90_000;
/** A run marked "processing" that never finished is retried after this long. */
const STUCK_MS = 10 * 60_000;

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
      .select("id, updated_at, processing_status, embedding")
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
      if (status === "processing") return age > STUCK_MS;
      if (status === "failed") return true;
      if (status === "skipped_short" || status === "skipped_empty") return false;
      if (status === "skipped_no_credits") return true;
      if (status === "processed") return !row.embedding;
      // null / unknown status: legacy note — process when it has no embedding.
      return !row.embedding;
    };

    const targets = (candidates || []).filter(needsWork).slice(0, limit);
    if (targets.length === 0) {
      return json({ scanned: candidates?.length ?? 0, triggered: 0, ids: [] });
    }

    for (const note of targets) {
      try {
        await fetch(`${SUPABASE_URL}/functions/v1/process-note`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ note_id: note.id }),
        });
      } catch (err) {
        console.error("sweep: process-note trigger failed", note.id, err);
      }
    }

    return json({
      scanned: candidates?.length ?? 0,
      triggered: targets.length,
      ids: targets.map((n: any) => n.id),
    });
  } catch (err) {
    console.error("sweep-note-processing error:", err);
    return json({ error: err instanceof Error ? err.message : "Internal error" }, 500);
  }
});
