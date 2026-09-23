/**
 * Compare a presented secret with the expected one without leaking, through
 * timing, how many leading characters matched. `===` on strings stops at the
 * first difference. Both sides are hashed first and the fixed-length digests
 * compared in full, the same technique as `cron-auth.ts`.
 *
 * An empty expected value never matches: an unset env secret must not let an
 * empty header through.
 *
 * No Deno APIs, so the Node test runner can import this directly.
 */
async function digest(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

export async function secretEquals(presented: string | null | undefined, expected: string | null | undefined): Promise<boolean> {
  if (!expected || typeof presented !== "string" || !presented) return false;
  const [a, b] = await Promise.all([digest(presented), digest(expected)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
