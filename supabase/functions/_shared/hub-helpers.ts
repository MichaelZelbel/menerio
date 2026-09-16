/**
 * Shared helpers for Hub API edge functions.
 */

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

export function json(
  body: unknown,
  status = 200,
  extra?: Record<string, string>
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", ...extra },
  });
}

export function errorJson(
  code: string,
  message: string,
  status: number
) {
  return json({ error: { code, message } }, status);
}

export function handleOptions() {
  return new Response("ok", { headers: corsHeaders });
}

export function parsePath(url: URL): string[] {
  return url.pathname.split("/").filter(Boolean);
}

/**
 * An integer query parameter, clamped, or the fallback when it is missing or
 * not a number. `parseInt("all")` is NaN, and NaN walks through Math.min and
 * Math.max untouched; `.range(NaN, NaN)` then fails at PostgREST and the
 * request answered 500 for a typo in the URL.
 */
export function intParam(url: URL, name: string, fallback: number, min: number, max: number): number {
  const parsed = parseInt(url.searchParams.get(name) ?? "", 10);
  const value = Number.isFinite(parsed) ? parsed : fallback;
  return Math.min(Math.max(value, min), max);
}

export function paginationParams(url: URL) {
  const limit = intParam(url, "limit", 50, 1, 200);
  const offset = intParam(url, "offset", 0, 0, Number.MAX_SAFE_INTEGER);
  return { limit, offset };
}
