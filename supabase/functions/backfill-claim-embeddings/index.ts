// Embed claims that have no embedding. The only place a claim is embedded
// (docs/plans/one-fact-store.md, 3.6): add_claim no longer embeds inline, and
// claim_clear_embedding empties the vector whenever a claim's words change, so
// this job re-embeds corrected facts too. An unembedded claim is invisible to
// search_brain's claim arm and still readable through get_claims, so this is
// a search-quality job, never a data-integrity one.
//
// Embedding sends the words to the embedding provider. Candidates therefore
// come from agent_facts (current or not): a fact in a private section, or about
// a hidden or sensitive person or entity, is never sent. When a person becomes
// visible again, the next run embeds their facts.
//
// The evidence quote is what gets embedded when there is one. "employer: Acme"
// is three words and matches badly; the sentence a fact came from is what a
// person would actually type into a search box.
//
// Three ways in:
//   - the scheduler: x-cron-key header (internal.call_edge); loops over every
//     user with unembedded claims, `limit` claims per user per run;
//   - the caller's JWT: that user's claims;
//   - the service role key with an explicit target_user_id: an admin trigger.
//
// POST { limit?: number = 50, dry_run?: boolean = false, target_user_id? }
// → { scanned, updated, failures, remaining } (per user under "users" for cron)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getEmbeddingWithCredits } from "../_shared/llm-credits.ts";
import { isValidCronRequest } from "../_shared/cron-auth.ts";
import { embeddingCandidates, embeddingText } from "../_shared/agent-facts.ts";
import { selectAllRows } from "../_shared/paged-select.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY")!;

/** A user whose embeddings keep failing (no credits, provider down) is left for the next run. */
const MAX_FAILURES_IN_A_ROW = 3;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-key",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

// Metered: balance check and a ledger row per claim embedded.
async function getEmbedding(db: any, userId: string, text: string): Promise<number[]> {
  const { embedding } = await getEmbeddingWithCredits(db, OPENROUTER_API_KEY, userId, "backfill-claim-embeddings", text);
  return embedding;
}

interface RunResult {
  scanned: number;
  updated: number;
  failures: number;
  remaining: number;
  dry_run?: boolean;
}

async function embedForUser(admin: any, userId: string, limit: number, dryRun: boolean): Promise<RunResult> {
  const { candidates, total } = await embeddingCandidates(admin, userId, limit);
  if (dryRun || candidates.length === 0) {
    return { scanned: candidates.length, updated: 0, failures: 0, remaining: total, ...(dryRun ? { dry_run: true } : {}) };
  }
  let updated = 0;
  let failures = 0;
  let inARow = 0;
  for (const c of candidates) {
    try {
      const emb = await getEmbedding(admin, userId, embeddingText(c));
      // Only if the words are still the ones embedded and nothing embedded it
      // meanwhile: a fact corrected during the call keeps a NULL vector and is
      // picked up next run with its new words.
      const { error } = await admin
        .from("claims")
        .update({ embedding: emb })
        .eq("id", c.claim_id)
        .eq("user_id", userId)
        .eq("attribute", c.attribute)
        .eq("value", c.value)
        .is("embedding", null);
      if (error) { failures++; inARow++; } else { updated++; inARow = 0; }
    } catch (_e) {
      failures++;
      inARow++;
    }
    if (inARow >= MAX_FAILURES_IN_A_ROW) break;
  }
  // Report what is LEFT, not just what was done. A caller looping until zero
  // needs the number that actually reaches zero.
  return { scanned: candidates.length, updated, failures, remaining: Math.max(0, total - updated) };
}

/** Every user with at least one claim that has no embedding. */
async function usersWithUnembeddedClaims(admin: any): Promise<string[]> {
  const rows = await selectAllRows<{ user_id: string }>((from, to) =>
    admin.from("claims").select("user_id").is("embedding", null).order("id").range(from, to));
  return [...new Set(rows.map((r) => r.user_id).filter(Boolean))];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const limit = Math.max(1, Math.min(200, Number(body?.limit ?? 50) || 50));
    const dryRun = Boolean(body?.dry_run ?? false);
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // The scheduler. The header is the only thing that authenticates it.
    if (req.headers.get("x-cron-key")) {
      if (!(await isValidCronRequest(req))) return json({ error: "Unauthorized" }, 401);
      const users = await usersWithUnembeddedClaims(admin);
      const results: Array<{ user_id: string } & (RunResult | { error: string })> = [];
      for (const userId of users) {
        try {
          results.push({ user_id: userId, ...await embedForUser(admin, userId, limit, dryRun) });
        } catch (err) {
          // One user's failed read must not stop the others.
          results.push({ user_id: userId, error: (err as Error).message });
        }
      }
      return json({ users: results.length, results });
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

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

    const result = await embedForUser(admin, userId, limit, dryRun);
    if (result.scanned === 0 && !dryRun) return json({ ...result, message: "No claims need embeddings." });
    return json(result);
  } catch (err: unknown) {
    return json({ error: (err as Error).message }, 500);
  }
});
