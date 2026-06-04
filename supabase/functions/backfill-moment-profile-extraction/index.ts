// Re-runs the moment → profile extraction pipeline on a user's existing
// timeline moments. Mirrors `backfill-profile-extraction` but for moments.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { extractProfileFromMoment, createServiceClient } from "../_shared/moment-profile-extraction.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const supabase = createServiceClient();

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

type Body = { limit?: number; contact_id?: string | null };

async function runBackfill(userId: string, body: Body) {
  const limit = Math.min(Math.max(body.limit ?? 200, 1), 500);

  let momentIds: string[] = [];

  if (body.contact_id) {
    const { data: rows } = await supabase
      .from("moment_participants")
      .select("moment_id, moments!inner(user_id, deleted_at, ai_visibility, happened_at)")
      .eq("person_id", body.contact_id)
      .eq("moments.user_id", userId)
      .is("moments.deleted_at", null)
      .eq("moments.ai_visibility", "visible")
      .order("happened_at", { foreignTable: "moments", ascending: false })
      .limit(limit);
    momentIds = (rows || []).map((r: any) => r.moment_id);
  } else {
    const { data: rows } = await supabase
      .from("moments")
      .select("id")
      .eq("user_id", userId)
      .is("deleted_at", null)
      .eq("ai_visibility", "visible")
      .order("happened_at", { ascending: false })
      .limit(limit);
    momentIds = (rows || []).map((r: any) => r.id);
  }

  let scanned = 0;
  let suggestions_created = 0;
  let auto_applied = 0;
  let skipped = 0;

  for (const id of momentIds) {
    try {
      const result = await extractProfileFromMoment(supabase, id);
      scanned += result.scanned;
      suggestions_created += result.suggestions_created;
      auto_applied += result.auto_applied;
      if (result.skipped_reason) skipped++;
      await new Promise((r) => setTimeout(r, 150));
    } catch (err) {
      console.error("[backfill-moment-profile] error for", id, err);
      skipped++;
    }
  }

  return { total: momentIds.length, scanned, suggestions_created, auto_applied, skipped };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "unauthorized" }, 401);

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await userClient.auth.getUser(authHeader.replace("Bearer ", ""));
    if (authErr || !user) return json({ error: "unauthorized" }, 401);

    const body: Body = req.headers.get("content-type")?.includes("application/json")
      ? await req.json().catch(() => ({}))
      : {};

    // @ts-expect-error EdgeRuntime is a Supabase global
    EdgeRuntime.waitUntil(runBackfill(user.id, body).then((result) => {
      console.log(`[backfill-moment-profile-extraction] user=${user.id} result=`, result);
    }));

    return json({
      ok: true,
      started: true,
      message: "Timeline backfill running in background. Check the People list / Review Queue in a few minutes.",
    });
  } catch (err) {
    console.error("backfill-moment-profile-extraction error:", err);
    return json({ error: err instanceof Error ? err.message : "Internal error" }, 500);
  }
});
