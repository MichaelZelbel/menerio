// Backfill embeddings for claims that are missing one.
//
// add_claim embeds at write time, best-effort. This is the sweeper for two
// cases it cannot cover: claims written before the column existed, and claims
// whose write-time embedding failed because the provider had a bad minute.
// An unembedded claim is invisible to search_brain's claim arm and still
// perfectly readable through get_claims, so this is a search-quality job and
// never a data-integrity one.
//
// The evidence quote is what gets embedded when there is one. "employer: Acme"
// is three words and matches badly; the sentence a fact came from is what a
// person would actually type into a search box.
//
// Auth mirrors backfill-embeddings: caller's JWT, or the service role key with
// an explicit target_user_id for an admin trigger.
//
// POST { limit?: number = 50, dry_run?: boolean = false }
// → { scanned, updated, failures, remaining }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY")!;
const OPENROUTER_BASE = "https://openrouter.ai/api/v1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

async function getEmbedding(text: string): Promise<number[]> {
  const r = await fetch(`${OPENROUTER_BASE}/embeddings`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: "openai/text-embedding-3-small", input: text }),
  });
  if (!r.ok) throw new Error(`OpenRouter embeddings failed: ${r.status} ${await r.text().catch(() => "")}`);
  const d = await r.json();
  return d.data[0].embedding;
}

function textFor(c: { attribute: string; value: string; evidence_quote: string | null }) {
  const triple = `${c.attribute}: ${c.value}`;
  return c.evidence_quote ? `${triple}\n${c.evidence_quote}` : triple;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const limit = Math.max(1, Math.min(200, Number(body?.limit ?? 50)));
    const dryRun = Boolean(body?.dry_run ?? false);

    let userId: string | null = null;
    const bearer = authHeader.replace(/^Bearer\s+/i, "");
    if (bearer === SUPABASE_SERVICE_ROLE_KEY) {
      const targetUserId = String(body?.target_user_id || "").trim();
      if (!targetUserId) return json({ error: "target_user_id required for admin trigger" }, 400);
      userId = targetUserId;
    } else {
      const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: userData, error: userErr } = await userClient.auth.getUser();
      if (userErr || !userData?.user) return json({ error: "Unauthorized" }, 401);
      userId = userData.user.id;
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: candidates, error: selErr } = await admin
      .from("claims")
      .select("id, attribute, value, evidence_quote")
      .eq("user_id", userId)
      .is("embedding", null)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (selErr) return json({ error: selErr.message }, 500);
    if (!candidates || candidates.length === 0) {
      return json({ scanned: 0, updated: 0, failures: 0, remaining: 0, message: "No claims need embeddings." });
    }
    if (dryRun) {
      return json({ scanned: candidates.length, updated: 0, failures: 0, dry_run: true });
    }

    let updated = 0;
    let failures = 0;
    for (const c of candidates) {
      try {
        const emb = await getEmbedding(textFor(c as any));
        const { error } = await admin.from("claims").update({ embedding: emb }).eq("id", (c as any).id);
        if (error) failures++;
        else updated++;
      } catch (_e) {
        failures++;
      }
    }

    // Report what is LEFT, not just what was done. A caller looping until zero
    // needs the number that actually reaches zero.
    const { count } = await admin
      .from("claims")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .is("embedding", null);

    return json({ scanned: candidates.length, updated, failures, remaining: count ?? 0 });
  } catch (err: unknown) {
    return json({ error: (err as Error).message }, 500);
  }
});
