/**
 * The rules of the "connect your mission control" flow, with nothing else in the file.
 *
 * A mission control (a folder of files on someone's computer that their AI assistants work
 * from) asks for access, the person confirms in the browser, and Mission Control
 * collects a key. `mc-connect/index.ts` does the talking and the SQL functions
 * in 20260920120000_godspeed_connections.sql do the writing; every number, every
 * code and every "is this allowed" they rely on is here, so it can be tested
 * without a database or a network.
 *
 * Pure TypeScript on purpose: no Deno global, no imports, no fetch. WebCrypto
 * (`crypto.subtle`) is the one platform API used, and both Deno and the Node
 * test runner have it.
 */

// ── Limits ───────────────────────────────────────────────────────────────────

export const GODSPEED_CONNECT_LIMITS = {
  /** Wrong comparison codes on the approval page before the request is denied. */
  maxWrongCodes: 5,
  /** Wrong verifiers at /token before the request dies. */
  maxWrongVerifiers: 5,
  /** What /start tells Mission Control to wait between polls, in seconds. */
  pollIntervalSeconds: 3,
  /**
   * What /token actually enforces, in milliseconds. One second less than the
   * advertised interval: a mission control that polls exactly on time still arrives a few
   * milliseconds early now and then, and that is not the polling this guards
   * against.
   */
  minPollGapMs: 2000,
  /** How long a request can be approved and collected, in seconds. */
  requestTtlSeconds: 600,
  /** Requests one caller address may start per hour. */
  startsPerHour: 10,
} as const;

/**
 * What a step 1 grant may touch. The same list the key Mission Control uses today
 * carries, so nothing an assistant can do now is lost by connecting this way.
 */
export const GODSPEED_GRANT_SCOPES = [
  "profile", "notes", "contacts", "actions", "graph",
  "media", "stats", "world", "lexicon", "collections",
] as const;

export const DEFAULT_APP_URL = "https://menerio.com";
export const CONNECT_PAGE_PATH = "/connect-godspeed";

// ── The comparison code ──────────────────────────────────────────────────────

/**
 * Consonants only. No vowels, so a code never spells a word, and no digits, so
 * nobody has to ask whether that was a zero or an O.
 */
export const USER_CODE_ALPHABET = "BCDFGHJKLMNPQRSTVWXZ";
export const USER_CODE_LENGTH = 8;

/** Bytes at or above this are thrown away so every letter is equally likely. */
const UNBIASED_BYTE_CEILING = 256 - (256 % USER_CODE_ALPHABET.length);

function withDash(letters: string): string {
  return `${letters.slice(0, 4)}-${letters.slice(4)}`;
}

/**
 * A fresh code such as "BCDF-GHJK".
 *
 * The random source is handed in so a test can make it predictable; the edge
 * function passes crypto.getRandomValues.
 */
export function generateUserCode(randomBytes: (count: number) => Uint8Array): string {
  let letters = "";
  // A source that never produces a usable byte would otherwise spin forever.
  for (let round = 0; letters.length < USER_CODE_LENGTH && round < 64; round++) {
    for (const byte of randomBytes(USER_CODE_LENGTH * 2)) {
      if (byte >= UNBIASED_BYTE_CEILING) continue;
      letters += USER_CODE_ALPHABET[byte % USER_CODE_ALPHABET.length];
      if (letters.length === USER_CODE_LENGTH) break;
    }
  }
  if (letters.length < USER_CODE_LENGTH) throw new Error("random source produced no usable bytes");
  return withDash(letters);
}

/**
 * The code as it is stored, from whatever the person typed or the link carried:
 * any case, with or without the dash, with stray spaces. Null when it cannot be
 * a code at all, which still counts as a wrong attempt at /approve.
 */
export function normalizeUserCode(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const letters = input.toUpperCase().replace(/[\s\-\u2010-\u2015_.]/g, "");
  if (letters.length !== USER_CODE_LENGTH) return null;
  for (const letter of letters) {
    if (!USER_CODE_ALPHABET.includes(letter)) return null;
  }
  return withDash(letters);
}

// ── The verifier and its challenge (RFC 7636, S256) ──────────────────────────

const BASE64URL_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** base64url without padding, written out so it needs neither btoa nor Buffer. */
export function base64UrlEncode(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += BASE64URL_CHARS[a >> 2];
    out += BASE64URL_CHARS[((a & 3) << 4) | (b >> 4)];
    if (i + 1 < bytes.length) out += BASE64URL_CHARS[((b & 15) << 2) | (c >> 6)];
    if (i + 2 < bytes.length) out += BASE64URL_CHARS[c & 63];
  }
  return out;
}

/** A SHA-256 digest in base64url is always 43 characters. */
const CODE_CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
/** RFC 7636 section 4.1: 43 to 128 unreserved characters. */
const CODE_VERIFIER_PATTERN = /^[A-Za-z0-9\-._~]{43,128}$/;

export function isCodeChallenge(value: unknown): value is string {
  return typeof value === "string" && CODE_CHALLENGE_PATTERN.test(value);
}

export function isCodeVerifier(value: unknown): value is string {
  return typeof value === "string" && CODE_VERIFIER_PATTERN.test(value);
}

/** base64url(sha256(verifier)), the value /start was given as `code_challenge`. */
export async function computeS256Challenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64UrlEncode(new Uint8Array(digest));
}

/**
 * True when the verifier is the one the challenge was made from.
 *
 * The database makes the same comparison under a row lock when a key is
 * collected (so that wrong guesses are counted even when they arrive
 * together); this is the same rule for anything that holds both values.
 */
export async function verifyS256(verifier: unknown, challenge: unknown): Promise<boolean> {
  if (!isCodeVerifier(verifier) || !isCodeChallenge(challenge)) return false;
  const computed = await computeS256Challenge(verifier);
  let difference = 0;
  for (let i = 0; i < computed.length; i++) {
    difference |= computed.charCodeAt(i) ^ challenge.charCodeAt(i);
  }
  return difference === 0;
}

// ── The request and what each status allows ──────────────────────────────────

export const REQUEST_STATUSES = ["pending", "approved", "denied", "collected", "expired"] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

/**
 * Where a request can go from each status. Anything not listed is final.
 * An approved request can still expire: Mission Control has the same ten minutes to
 * collect the key as the person had to say yes.
 */
const TRANSITIONS: Record<RequestStatus, readonly RequestStatus[]> = {
  pending: ["approved", "denied", "expired"],
  approved: ["collected", "expired"],
  denied: [],
  collected: [],
  expired: [],
};

export function canTransition(from: RequestStatus, to: RequestStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function isFinal(status: RequestStatus): boolean {
  return TRANSITIONS[status].length === 0;
}

/** A pending request past its time is expired, whatever the row still says. */
export function effectiveStatus(status: RequestStatus, expiresAt: string | Date, now: Date = new Date()): RequestStatus {
  if (isFinal(status)) return status;
  return new Date(expiresAt).getTime() <= now.getTime() ? "expired" : status;
}

/** The approval page may show, and the person may answer, only an open request. */
export function isOpenForApproval(status: RequestStatus): boolean {
  return status === "pending";
}

/** The key can be handed over from exactly one status, exactly once. */
export function isCollectable(status: RequestStatus): boolean {
  return status === "approved";
}

export function isPolledTooSoon(lastPollAt: string | Date | null, now: Date = new Date()): boolean {
  if (!lastPollAt) return false;
  return now.getTime() - new Date(lastPollAt).getTime() < GODSPEED_CONNECT_LIMITS.minPollGapMs;
}

/** The fifth wrong code (or verifier) is the one that ends the request. */
export function isLastWrongAttempt(wrongSoFar: number, max: number): boolean {
  return wrongSoFar + 1 >= max;
}

// ── Error codes ──────────────────────────────────────────────────────────────

export const GODSPEED_CONNECT_ERRORS = {
  invalid_request: { status: 400, message: "The request is missing something or has a value that cannot be right." },
  invalid_grant: { status: 400, message: "The verifier does not match this request." },
  wrong_code: { status: 400, message: "That code does not match. Compare it with the one your mission control shows." },
  unauthorized: { status: 401, message: "Sign in to Menerio first." },
  invalid_key: { status: 401, message: "This key is not valid." },
  revoked: { status: 401, message: "This mission control's connection to Menerio was ended." },
  access_denied: { status: 403, message: "The request was declined." },
  legacy_key: { status: 403, message: "This key was not made by connecting a mission control, so there is no connection to end. Revoke it under Settings, API Keys." },
  not_found: { status: 404, message: "This request is not open. It may have expired or been answered already." },
  method_not_allowed: { status: 405, message: "That route does not take this method." },
  expired_token: { status: 410, message: "This request has expired or its key was already collected. Start again from Mission Control." },
  authorization_pending: { status: 428, message: "Nobody has answered the request yet." },
  slow_down: { status: 429, message: "Too many requests. Wait a little and try again." },
  server_error: { status: 500, message: "Something went wrong on our side." },
  unavailable: { status: 503, message: "Menerio could not check this right now. Try again in a moment." },
} as const;

export type GodspeedConnectErrorCode = keyof typeof GODSPEED_CONNECT_ERRORS;

/**
 * What /token answers for a request that cannot be collected right now, or
 * null when it can. A collected request says "expired" on purpose: the key is
 * returned once, and a second asker learns nothing more than that.
 */
export function tokenErrorForStatus(status: RequestStatus): GodspeedConnectErrorCode | null {
  switch (status) {
    case "approved": return null;
    case "pending": return "authorization_pending";
    case "denied": return "access_denied";
    case "collected":
    case "expired": return "expired_token";
  }
}

// ── What Mission Control sends ───────────────────────────────────────────────────────

export const CONNECT_FLOWS = ["browser", "device"] as const;
export type ConnectFlow = (typeof CONNECT_FLOWS)[number];

export const CLIENT_STATES = ["received", "configured", "working", "waiting", "failed"] as const;
export type ClientState = (typeof CLIENT_STATES)[number];

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** `claude-code`, `codex`, `mc-bot`: a short lowercase name, nothing a page could not show. */
const CLIENT_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,39}$/;
const MAX_NAME_LENGTH = 80;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

/**
 * A mission control or device name fit to show on the approval page: control characters
 * out, runs of space collapsed, cut to a length that fits a line. Null when
 * nothing readable is left.
 */
export function cleanDisplayName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  // Control characters are exactly what this is looking for.
  // deno-lint-ignore no-control-regex
  // eslint-disable-next-line no-control-regex
  const cleaned = value.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_NAME_LENGTH)
    .trim();
  return cleaned.length > 0 ? cleaned : null;
}

export interface ConnectWants {
  context: true;
  documents: boolean;
}

/**
 * What Mission Control asked for, reduced to the two switches that exist. Context is
 * what connecting means, so it is always on; `documents` is remembered and
 * does nothing else in step 1.
 */
export function normalizeWants(value: unknown): ConnectWants {
  const documents = !!value && typeof value === "object" && (value as Record<string, unknown>).documents === true;
  return { context: true, documents };
}

export interface StartRequest {
  godspeedId: string;
  godspeedName: string;
  deviceId: string;
  deviceName: string;
  codeChallenge: string;
  flow: ConnectFlow;
  wants: ConnectWants;
}

/** The body of POST /start, checked. `problem` names the first field that is wrong. */
export function parseStartRequest(body: Record<string, unknown>): { request: StartRequest; problem: null } | { request: null; problem: string } {
  const fail = (problem: string) => ({ request: null, problem });
  if (!isUuid(body.godspeed_id)) return fail("godspeed_id must be a UUID");
  if (!isUuid(body.device_id)) return fail("device_id must be a UUID");
  const godspeedName = cleanDisplayName(body.godspeed_name);
  if (!godspeedName) return fail("godspeed_name is required");
  const deviceName = cleanDisplayName(body.device_name);
  if (!deviceName) return fail("device_name is required");
  if (body.code_challenge_method !== "S256") return fail("code_challenge_method must be S256");
  if (!isCodeChallenge(body.code_challenge)) return fail("code_challenge must be a base64url SHA-256 digest");
  const flow = body.flow === undefined ? "browser" : body.flow;
  if (!CONNECT_FLOWS.includes(flow as ConnectFlow)) return fail("flow must be browser or device");
  return {
    request: {
      godspeedId: body.godspeed_id.toLowerCase(),
      godspeedName,
      deviceId: body.device_id.toLowerCase(),
      deviceName,
      codeChallenge: body.code_challenge,
      flow: flow as ConnectFlow,
      wants: normalizeWants(body.wants),
    },
    problem: null,
  };
}

export interface ContactHeaders {
  deviceId: string | null;
  deviceName: string | null;
  client: string | null;
  clientState: ClientState | null;
}

/**
 * The X-Godspeed-* headers of GET /status. Anything malformed is dropped rather than
 * refused: a status call with a badly named client should still answer, it just
 * records less.
 */
export function parseContactHeaders(get: (name: string) => string | null): ContactHeaders {
  const deviceId = get("x-godspeed-device-id");
  const client = (get("x-godspeed-client") ?? "").trim().toLowerCase();
  const state = (get("x-godspeed-client-state") ?? "").trim().toLowerCase();
  const validClient = CLIENT_NAME_PATTERN.test(client) ? client : null;
  return {
    deviceId: isUuid(deviceId) ? deviceId.toLowerCase() : null,
    deviceName: cleanDisplayName(get("x-godspeed-device-name")),
    client: validClient,
    clientState: validClient && CLIENT_STATES.includes(state as ClientState) ? (state as ClientState) : null,
  };
}

// ── The caller's address ─────────────────────────────────────────────────────

/**
 * The address a request came from, for the ten-an-hour limit on /start.
 *
 * `cf-connecting-ip` first because the network edge in front of the functions
 * sets it itself; the first entry of `x-forwarded-for` is whatever the caller
 * chose to put there. One shared bucket when there is nothing at all.
 */
export function callerAddress(get: (name: string) => string | null): string {
  const direct = (get("cf-connecting-ip") ?? get("x-real-ip") ?? "").trim();
  if (direct) return direct;
  const forwarded = (get("x-forwarded-for") ?? "").split(",")[0].trim();
  return forwarded || "unknown";
}

/**
 * The address as it is stored: an HMAC, never the address. A bare SHA-256 of an
 * IPv4 address can be reversed by trying all four billion of them, so the hash
 * is keyed with a secret only the server holds.
 */
export async function hashCallerAddress(address: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(`mc-connect:${address}`));
  return Array.from(new Uint8Array(signature)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ── The links /start hands back ──────────────────────────────────────────────

export function verificationUris(appUrl: string, requestId: string, userCode: string): { verification_uri: string; verification_uri_complete: string } {
  const page = `${appUrl.replace(/\/+$/, "")}${CONNECT_PAGE_PATH}`;
  return {
    verification_uri: page,
    verification_uri_complete: `${page}?request=${encodeURIComponent(requestId)}&code=${encodeURIComponent(userCode)}`,
  };
}
