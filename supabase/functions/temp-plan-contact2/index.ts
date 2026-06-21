// TEMPORARY READ-ONLY — deleted after verification.
import { createClient } from "npm:@supabase/supabase-js@2";
import { planSubjectNormalization } from "../_shared/profile-normalization.ts";

const GATE = "5e7f1a02-9d3b-4c8e-aa15-721b0f6d4c93";

Deno.serve(async (req) => {
  if (req.headers.get("x-access-key") !== GATE) {
    return new Response("forbidden", { status: 403 });
  }
  try {
    const service = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const groups = await planSubjectNormalization({
      supabase: service,
      userId: "4332607c-1ddd-4a5d-8765-a44963e4fe12",
      contactId: "cf9b5d76-d027-4366-95dd-0e11615f3519",
    });
    return Response.json({ groups });
  } catch (e) {
    return Response.json({ error: String((e as Error).message || e) }, { status: 500 });
  }
});
