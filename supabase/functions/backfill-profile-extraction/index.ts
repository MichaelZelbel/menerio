// Re-runs the metadata + profile-fact extraction pipeline on a user's existing
// notes so newly-loosened extraction rules can populate profiles from the
// backlog. Idempotent: dedup logic in process-note prevents duplicate
// suggestions or profile_entries.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type Body = {
  limit?: number;
  contact_id?: string | null;
};

async function runBackfill(userId: string, authHeader: string, body: Body) {
  const limit = Math.min(Math.max(body.limit ?? 200, 1), 500);

  const query = supabase
    .from("notes")
    .select("id, metadata, created_at")
    .eq("user_id", userId)
    .eq("is_trashed", false)
    .eq("ai_visibility", "visible")
    .order("created_at", { ascending: false })
    .limit(limit);

  const { data: notes, error } = await query;
  if (error) {
    console.error("backfill notes fetch error:", error);
    return { scanned: 0, triggered: 0, skipped: 0, error: error.message };
  }

  let triggered = 0;
  let skipped = 0;

  for (const note of notes || []) {
    // If a contact filter is set, only process notes that mention that contact
    // (via metadata.matched_people).
    if (body.contact_id) {
      const meta = (note.metadata || {}) as Record<string, unknown>;
      const matched = Array.isArray((meta as any).matched_people)
        ? ((meta as any).matched_people as Array<{ contact_id?: string }>)
        : [];
      if (!matched.some((m) => m.contact_id === body.contact_id)) {
        skipped++;
        continue;
      }
    }

    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/process-note`, {
        method: "POST",
        headers: {
          Authorization: authHeader,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ note_id: note.id }),
      });
      if (res.ok) triggered++;
      else skipped++;
      // Small delay to avoid hammering downstream LLM calls
      await new Promise((r) => setTimeout(r, 150));
    } catch (err) {
      console.error("backfill trigger error for note", note.id, err);
      skipped++;
    }
  }

  return { scanned: (notes || []).length, triggered, skipped };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "unauthorized" }, 401);

    const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await userClient.auth.getUser(
      authHeader.replace("Bearer ", ""),
    );
    if (authErr || !user) return json({ error: "unauthorized" }, 401);

    const body: Body = req.headers.get("content-type")?.includes("application/json")
      ? await req.json().catch(() => ({}))
      : {};

    // @ts-expect-error EdgeRuntime is a Supabase global
    EdgeRuntime.waitUntil(runBackfill(user.id, authHeader, body).then((result) => {
      console.log(`[backfill-profile-extraction] user=${user.id} result=`, result);
    }));

    return json({ ok: true, started: true, message: "Backfill running in background. Check the People list / Review Queue in a few minutes." });
  } catch (err) {
    console.error("backfill-profile-extraction error:", err);
    return json({ error: err instanceof Error ? err.message : "Internal error" }, 500);
  }
});
