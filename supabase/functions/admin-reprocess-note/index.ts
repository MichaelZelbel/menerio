// TEMPORARY diagnostic helper — deleted after verification.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  let body: any;
  try { body = await req.json(); } catch { body = {}; }
  const noteId = String(body?.note_id || "");
  if (!noteId) return new Response(JSON.stringify({ error: "note_id required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  let deleted: any = null;
  if (body?.clear_pending_moments === true) {
    const { data, error } = await admin
      .from("review_queue")
      .delete()
      .eq("source_note_id", noteId)
      .eq("suggestion_type", "add_moment")
      .eq("status", "pending_review")
      .select("id");
    deleted = error ? { error: error.message } : { ids: data?.map((r: any) => r.id) ?? [] };
  }

  const res = await fetch(`${SUPABASE_URL}/functions/v1/process-note`, {
    method: "POST",
    headers: { Authorization: `Bearer ${SERVICE_ROLE}`, "Content-Type": "application/json" },
    body: JSON.stringify({ note_id: noteId }),
  });
  const text = await res.text();
  return new Response(JSON.stringify({ status: res.status, body: text, deleted }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
