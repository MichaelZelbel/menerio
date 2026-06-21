import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { planSubjectNormalization } from "../_shared/profile-normalization.ts";

const GATE = "a3f1b290-4c5d-4e8f-9b21-7c4d6e1f5a8b";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-gate",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.headers.get("x-gate") !== GATE) {
    return new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: corsHeaders });
  }
  const body = await req.json().catch(() => ({}));
  const userId = String(body?.userId || "");
  const contactId = body?.contactId ?? null;
  const includeNotesContext = body?.includeNotesContext !== false;
  if (!userId) return new Response(JSON.stringify({ error: "userId required" }), { status: 400, headers: corsHeaders });

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const groups = await planSubjectNormalization({ supabase: db, userId, contactId, includeNotesContext });
  return new Response(JSON.stringify({ groups }, null, 2), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
