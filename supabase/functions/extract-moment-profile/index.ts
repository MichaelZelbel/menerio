// Live extraction of profile facts from a single timeline moment. Called from
// AddEventDialog (after manual create/update) and from extract-event /
// draft-event after they materialize a moment from a note.

import { createServiceClient, extractProfileFromMoment } from "../_shared/moment-profile-extraction.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const supabase = createServiceClient();

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const momentId = typeof body?.moment_id === "string" ? body.moment_id : null;
    if (!momentId) return json({ error: "moment_id required" }, 400);

    // Authorize the caller. This runs with the service-role key and derives
    // user_id from the moment row, so without a check anyone could trigger an
    // LLM extraction against ANY user's moment (draining their credits and the
    // shared LLM budget) by guessing a moment UUID. Accept either an internal
    // service-role call, or a user JWT whose user owns the moment.
    const authHeader = req.headers.get("Authorization");
    const token = authHeader ? authHeader.replace("Bearer ", "").trim() : "";
    const isInternal = token !== "" && token === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!isInternal) {
      if (!token) return json({ error: "Unauthorized" }, 401);
      const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
      if (authErr || !user) return json({ error: "Unauthorized" }, 401);
      const { data: owned } = await supabase
        .from("moments")
        .select("user_id")
        .eq("id", momentId)
        .maybeSingle();
      if (!owned || owned.user_id !== user.id) return json({ error: "Forbidden" }, 403);
    }

    // @ts-expect-error EdgeRuntime is a Supabase global
    EdgeRuntime.waitUntil(
      extractProfileFromMoment(supabase, momentId).then((result) => {
        console.log(`[extract-moment-profile] moment=${momentId} result=`, result);
      }).catch((err) => console.error("[extract-moment-profile] error:", err)),
    );

    return json({ ok: true, processing: true });
  } catch (err) {
    console.error("extract-moment-profile error:", err);
    return json({ error: err instanceof Error ? err.message : "Internal error" }, 500);
  }
});
