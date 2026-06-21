// One-shot admin helper: re-invokes process-note for a given note_id using
// the service role key. Gated by MCP_ACCESS_KEY header. Temporary diagnostic tool.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ADMIN_KEY = Deno.env.get("MCP_ACCESS_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const provided = req.headers.get("x-admin-key") || "";
  if (!ADMIN_KEY || provided !== ADMIN_KEY) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: any;
  try { body = await req.json(); } catch { body = {}; }
  const noteId = String(body?.note_id || "");
  if (!noteId) {
    return new Response(JSON.stringify({ error: "note_id required" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const res = await fetch(`${SUPABASE_URL}/functions/v1/process-note`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SERVICE_ROLE}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ note_id: noteId }),
  });

  const text = await res.text();
  return new Response(JSON.stringify({ status: res.status, body: text }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
