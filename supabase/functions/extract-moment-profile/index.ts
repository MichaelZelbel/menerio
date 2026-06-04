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
