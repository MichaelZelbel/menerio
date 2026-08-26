// Shared authentication gate for scheduler-triggered edge functions.
//
// pg_cron jobs reach these functions through internal.call_edge (created by the
// cron_shared_secret migration), which attaches an "x-cron-key" header whose
// value lives ONLY in the database (internal.cron_secret). This helper fetches
// the expected value through the service-role-only RPC get_cron_secret() and
// compares digests. A plaintext body marker like {"cron": "..."} is routing
// information, never trust: the header is the only thing that authenticates.
//
// Fail closed: a missing header, missing secret, or failed RPC always denies.
// The scheduled sweeps are idempotent, so a denied tick is recovered by the
// next one; an open door is not recoverable.
//
// Rotation: UPDATE internal.cron_secret SET value = ... (see docs/CRON_JOBS.md).
// Jobs read the row per run, so they pick the new value up immediately; this
// helper refetches when a presented key stops matching, at most once per
// REFETCH_MIN_MS so a flood of bad keys cannot hammer the database.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const REFETCH_MIN_MS = 60_000;

let cachedSecret: string | null = null;
let lastFetchAt = 0;

async function fetchSecret(): Promise<string | null> {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return null;
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data, error } = await admin.rpc("get_cron_secret");
  if (error || typeof data !== "string" || data.length === 0) {
    console.error("[cron-auth] get_cron_secret unavailable", error?.message ?? "empty result");
    return null;
  }
  return data;
}

// Compare via digests instead of the raw strings so the comparison cost does
// not depend on where the first differing byte sits.
async function digestHex(value: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function matches(presented: string, secret: string): Promise<boolean> {
  return (await digestHex(presented)) === (await digestHex(secret));
}

/** True only when the request carries the scheduler's shared key. */
export async function isValidCronRequest(req: Request): Promise<boolean> {
  const presented = req.headers.get("x-cron-key") ?? "";
  if (!presented) return false;
  if (cachedSecret === null) {
    cachedSecret = await fetchSecret();
    lastFetchAt = Date.now();
    if (cachedSecret === null) return false;
  }
  if (await matches(presented, cachedSecret)) return true;
  if (Date.now() - lastFetchAt < REFETCH_MIN_MS) return false;
  const fresh = await fetchSecret();
  lastFetchAt = Date.now();
  if (fresh !== null) cachedSecret = fresh;
  return fresh !== null && (await matches(presented, fresh));
}
