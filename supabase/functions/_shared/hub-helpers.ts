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

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True for a canonical UUID string, the shape every Hub API row id has. */
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

/**
 * The request body as a plain object, or a 400 to return.
 *
 * `await req.json()` throws on malformed JSON, and the outer catch turned that
 * into a 500 "Unexpected token" as if the server had broken. A body of `null`
 * or `[]` parsed fine and then `body.title` threw a TypeError, same 500.
 */
export async function readJsonObject(
  req: Request,
): Promise<{ body: Record<string, unknown>; error: null } | { body: null; error: Response }> {
  let parsed: unknown;
  try {
    parsed = await req.json();
  } catch {
    return { body: null, error: errorJson("BAD_REQUEST", "Request body must be valid JSON.", 400) };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { body: null, error: errorJson("BAD_REQUEST", "Request body must be a JSON object.", 400) };
  }
  return { body: parsed as Record<string, unknown>, error: null };
}

type FieldKind =
  | "string"
  | "nullable-string"
  | "boolean"
  | "string-array"
  | "object"
  | "nullable-uuid"
  | "nullable-date"
  | "nullable-timestamp"
  | "nullable-positive-int";

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function fieldTypeError(field: string, kind: FieldKind, value: unknown): string | null {
  const isNull = value === null;
  switch (kind) {
    case "string":
      return typeof value === "string" ? null : `${field} must be a string`;
    case "nullable-string":
      return isNull || typeof value === "string" ? null : `${field} must be a string or null`;
    case "boolean":
      return typeof value === "boolean" ? null : `${field} must be true or false`;
    case "string-array":
      return Array.isArray(value) && value.every((v) => typeof v === "string")
        ? null
        : `${field} must be an array of strings`;
    case "object":
      return value !== null && typeof value === "object" && !Array.isArray(value)
        ? null
        : `${field} must be a JSON object`;
    case "nullable-uuid":
      return isNull || isUuid(value) ? null : `${field} must be a UUID or null`;
    case "nullable-date":
      return isNull || (typeof value === "string" && DATE_ONLY.test(value) && !Number.isNaN(Date.parse(value)))
        ? null
        : `${field} must be a YYYY-MM-DD date or null`;
    case "nullable-timestamp":
      return isNull || (typeof value === "string" && !Number.isNaN(Date.parse(value)))
        ? null
        : `${field} must be an ISO date-time or null`;
    case "nullable-positive-int":
      return isNull || (typeof value === "number" && Number.isInteger(value) && value > 0)
        ? null
        : `${field} must be a positive integer or null`;
  }
}

/**
 * Copy the fields a PUT may change out of the body, checking each one's type.
 *
 * Every PUT used to copy whatever arrived straight into the update, and every
 * database error it caused (`tags: "x"` against a text[] column, a date that
 * is not a date) was answered 404 "not found". The caller was told the row
 * was missing when the row was fine and their input was not.
 */
export function pickTypedFields(
  body: Record<string, unknown>,
  spec: Record<string, FieldKind>,
): { updates: Record<string, unknown>; error: Response | null } {
  const updates: Record<string, unknown> = {};
  const problems: string[] = [];
  for (const [field, kind] of Object.entries(spec)) {
    if (body[field] === undefined) continue;
    const problem = fieldTypeError(field, kind, body[field]);
    if (problem) problems.push(problem);
    else updates[field] = body[field];
  }
  if (problems.length > 0) {
    return { updates, error: errorJson("BAD_REQUEST", problems.join("; "), 400) };
  }
  return { updates, error: null };
}

/**
 * The response for a failed insert or update.
 *
 * Postgres class 22 (data exception: bad date, bad uuid, value too long) and
 * class 23 (constraint violation: check, foreign key, not null, unique) are the
 * caller's input, so 400 with the database's own message. Anything else is
 * ours, so 500. "Not found" is decided by the caller from an empty result,
 * never from an error.
 */
export function dbErrorResponse(error: { code?: string; message: string }): Response {
  const code = error.code ?? "";
  if (code.startsWith("22") || code.startsWith("23")) {
    return errorJson("BAD_REQUEST", error.message, 400);
  }
  return errorJson("INTERNAL", error.message, 500);
}
