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

export function paginationParams(url: URL) {
  const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "50", 10), 1), 200);
  const offset = Math.max(parseInt(url.searchParams.get("offset") || "0", 10), 0);
  return { limit, offset };
}
