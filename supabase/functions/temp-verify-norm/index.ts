import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { planSubjectNormalization } from "../_shared/profile-normalization.ts";

const GATE = "9f3c8e21-7a44-4d6b-bf12-5e0a39b274dc";
const USER_ID = "4332607c-1ddd-4a5d-8765-a44963e4fe12";
const CONTACT_ID = "7d18d2a4-a65b-4cba-b90b-4edcd2044cdd";

serve(async (req) => {
  if (req.headers.get("x-temp-gate") !== GATE) {
    return new Response("forbidden", { status: 403 });
  }
  const url = Deno.env.get("SUPABASE_URL")!;
  const srv = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const admin = createClient(url, srv);

  const mode = new URL(req.url).searchParams.get("mode") || "plan";

  if (mode === "jwt") {
    const { data: u } = await admin.auth.admin.getUserById(USER_ID);
    const email = u?.user?.email!;
    const { data } = await admin.auth.admin.generateLink({ type: "magiclink", email });
    const tokenHash = (data as any)?.properties?.hashed_token;
    const anonC = createClient(url, anon);
    const { data: vd } = await anonC.auth.verifyOtp({ type: "magiclink", token_hash: tokenHash });
    return new Response(JSON.stringify({ access_token: vd.session?.access_token }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  const ownerGroups = await planSubjectNormalization({
    supabase: admin,
    userId: USER_ID,
    contactId: null,
    includeNotesContext: true,
  });
  const contactGroups = await planSubjectNormalization({
    supabase: admin,
    userId: USER_ID,
    contactId: CONTACT_ID,
    includeNotesContext: true,
  });
  return new Response(
    JSON.stringify({ owner: ownerGroups, contact: contactGroups }, null, 2),
    { headers: { "Content-Type": "application/json" } },
  );
});
