import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
Deno.serve(async (req: Request): Promise<Response> => {
  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return reply({ error: "Method not allowed" }, 405);
  const authorization = req.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return reply({ error: "Unauthorized" }, 401);
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authorization } }, auth: { persistSession: false },
  });
  const { data: { user }, error: authError } = await supabase.auth.getUser(authorization.slice(7));
  if (authError || !user) return reply({ error: "Unauthorized" }, 401);
  let body;
  try { body = await req.json(); } catch { return reply({ error: "Invalid JSON" }, 400); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return reply({ error: 'Invalid merge request' }, 400);
  const { source_contact_id, target_contact_id, merge_into_self = false, request_id } = body;
  if (!request_id || !source_contact_id) return reply({ error: "request_id and source_contact_id required" }, 400);
  const { data, error } = await supabase.rpc("merge_contacts_atomic", {
    p_request_id: request_id, p_source_contact_id: source_contact_id,
    p_target_contact_id: target_contact_id || null, p_merge_into_self: merge_into_self,
  });
  if (error) {
    const status = error.code === "42501" ? 403 : error.code === "PT409" ? 409 : ["22023", "22P02"].includes(error.code) ? 400 : 500;
    return reply({ error: status === 500 ? "Merge result could not be confirmed; retry this request" : error.message, code: error.code }, status);
  }
  return reply(data);
});


