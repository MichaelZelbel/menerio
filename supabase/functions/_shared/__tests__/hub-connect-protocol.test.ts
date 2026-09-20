import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  CLIENT_STATES,
  HUB_CONNECT_ERRORS,
  HUB_CONNECT_LIMITS,
  HUB_GRANT_SCOPES,
  REQUEST_STATUSES,
  USER_CODE_ALPHABET,
  base64UrlEncode,
  callerAddress,
  canTransition,
  cleanDisplayName,
  computeS256Challenge,
  effectiveStatus,
  generateUserCode,
  hashCallerAddress,
  isCodeChallenge,
  isCodeVerifier,
  isCollectable,
  isFinal,
  isLastWrongAttempt,
  isOpenForApproval,
  isPolledTooSoon,
  normalizeUserCode,
  normalizeWants,
  parseContactHeaders,
  parseStartRequest,
  tokenErrorForStatus,
  verificationUris,
  verifyS256,
} from "../hub-connect-protocol.ts";
import { mintHubKey } from "../hub-key-mint.ts";
import { sha256Hex } from "../sha256.ts";

// RFC 7636, appendix B.
const RFC_VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const RFC_CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

const counting = () => {
  let next = 0;
  return (count: number) => Uint8Array.from({ length: count }, () => next++ % 256);
};

describe("the comparison code", () => {
  it("uses an alphabet with no vowels and no digits", () => {
    expect(USER_CODE_ALPHABET).toBe("BCDFGHJKLMNPQRSTVWXZ");
    expect(USER_CODE_ALPHABET).not.toMatch(/[AEIOUY0-9]/);
    expect(new Set(USER_CODE_ALPHABET).size).toBe(USER_CODE_ALPHABET.length);
  });

  it("generates ABCD-EFGH from the injected random source", () => {
    expect(generateUserCode(counting())).toBe("BCDF-GHJK");
    for (let i = 0; i < 200; i++) {
      const code = generateUserCode((n) => crypto.getRandomValues(new Uint8Array(n)));
      expect(code).toMatch(/^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/);
    }
  });

  it("throws away bytes that would make some letters likelier than others", () => {
    // 240..255 do not divide evenly into twenty letters.
    const biased = [250, 255, 240, 0, 1, 2, 3, 4, 5, 6, 7];
    let at = 0;
    const code = generateUserCode((n) => Uint8Array.from({ length: n }, () => biased[at++ % biased.length]));
    expect(code).toBe("BCDF-GHJK");
  });

  it("gives up on a random source that never yields a usable byte", () => {
    expect(() => generateUserCode((n) => new Uint8Array(n).fill(255))).toThrow();
  });

  it("normalises case, spaces and the dash", () => {
    for (const typed of ["BCDF-GHJK", "bcdf-ghjk", " bcdf ghjk ", "BCDFGHJK", "bc df-gh jk", "BCDF\u2013GHJK"]) {
      expect(normalizeUserCode(typed)).toBe("BCDF-GHJK");
    }
  });

  it("refuses what cannot be a code", () => {
    for (const typed of ["", "BCDF-GHJ", "BCDF-GHJKL", "ACDF-GHJK", "BCDF-GH1K", null, undefined, 12345678, {}]) {
      expect(normalizeUserCode(typed)).toBeNull();
    }
  });
});

describe("S256", () => {
  it("encodes base64url without padding", () => {
    expect(base64UrlEncode(new Uint8Array([]))).toBe("");
    expect(base64UrlEncode(new Uint8Array([0xfb]))).toBe("-w");
    expect(base64UrlEncode(new Uint8Array([0xfb, 0xff]))).toBe("-_8");
    expect(base64UrlEncode(new Uint8Array([0xfb, 0xff, 0xfe]))).toBe("-__-");
    expect(base64UrlEncode(new TextEncoder().encode("hello world"))).toBe("aGVsbG8gd29ybGQ");
  });

  it("matches the known answer of RFC 7636 appendix B", async () => {
    expect(await computeS256Challenge(RFC_VERIFIER)).toBe(RFC_CHALLENGE);
    expect(await verifyS256(RFC_VERIFIER, RFC_CHALLENGE)).toBe(true);
  });

  it("refuses a verifier that is off by one character, or malformed", async () => {
    expect(await verifyS256(RFC_VERIFIER.replace(/k$/, "j"), RFC_CHALLENGE)).toBe(false);
    expect(await verifyS256("short", RFC_CHALLENGE)).toBe(false);
    expect(await verifyS256(RFC_VERIFIER, "not-a-challenge")).toBe(false);
    expect(await verifyS256(undefined, RFC_CHALLENGE)).toBe(false);
  });

  it("knows the shape of both values", () => {
    expect(isCodeChallenge(RFC_CHALLENGE)).toBe(true);
    expect(isCodeChallenge(RFC_CHALLENGE + "=")).toBe(false);
    expect(isCodeVerifier(RFC_VERIFIER)).toBe(true);
    expect(isCodeVerifier("a".repeat(42))).toBe(false);
    expect(isCodeVerifier("a".repeat(129))).toBe(false);
    expect(isCodeVerifier("a".repeat(42) + "+")).toBe(false);
  });
});

describe("the request state machine", () => {
  it("lets a pending request be approved, denied or expire, and nothing else", () => {
    expect(canTransition("pending", "approved")).toBe(true);
    expect(canTransition("pending", "denied")).toBe(true);
    expect(canTransition("pending", "expired")).toBe(true);
    expect(canTransition("pending", "collected")).toBe(false);
  });

  it("lets an approved request be collected once or expire", () => {
    expect(canTransition("approved", "collected")).toBe(true);
    expect(canTransition("approved", "expired")).toBe(true);
    expect(canTransition("approved", "denied")).toBe(false);
    expect(canTransition("approved", "pending")).toBe(false);
  });

  it("treats denied, collected and expired as final", () => {
    for (const status of ["denied", "collected", "expired"] as const) {
      expect(isFinal(status)).toBe(true);
      for (const to of REQUEST_STATUSES) expect(canTransition(status, to)).toBe(false);
    }
    expect(isFinal("pending")).toBe(false);
    expect(isFinal("approved")).toBe(false);
  });

  it("opens only a pending request for approval and only an approved one for collection", () => {
    expect(REQUEST_STATUSES.filter(isOpenForApproval)).toEqual(["pending"]);
    expect(REQUEST_STATUSES.filter(isCollectable)).toEqual(["approved"]);
  });

  it("expires a request by the clock, whatever the row still says", () => {
    const now = new Date("2026-09-20T12:00:00Z");
    expect(effectiveStatus("pending", "2026-09-20T12:00:01Z", now)).toBe("pending");
    expect(effectiveStatus("pending", "2026-09-20T12:00:00Z", now)).toBe("expired");
    expect(effectiveStatus("approved", "2026-09-20T11:59:59Z", now)).toBe("expired");
    expect(effectiveStatus("collected", "2026-09-20T11:00:00Z", now)).toBe("collected");
    expect(effectiveStatus("denied", "2026-09-20T11:00:00Z", now)).toBe("denied");
  });

  it("answers /token per status as the contract lists", () => {
    expect(tokenErrorForStatus("approved")).toBeNull();
    expect(tokenErrorForStatus("pending")).toBe("authorization_pending");
    expect(tokenErrorForStatus("denied")).toBe("access_denied");
    expect(tokenErrorForStatus("expired")).toBe("expired_token");
    // Collected says expired: the key is handed over once.
    expect(tokenErrorForStatus("collected")).toBe("expired_token");
  });

  it("names the same statuses as the table's CHECK constraint", () => {
    const sql = readFileSync("supabase/migrations/20260920120000_hub_connections.sql", "utf8");
    const check = sql.match(/CHECK \(status IN \(('pending'[^)]*)\)\)/);
    expect(check).not.toBeNull();
    const inSql = check![1].split(",").map((s) => s.trim().replace(/'/g, ""));
    expect(inSql).toEqual([...REQUEST_STATUSES]);
  });
});

describe("limits", () => {
  it("are the numbers of the contract", () => {
    expect(HUB_CONNECT_LIMITS.maxWrongCodes).toBe(5);
    expect(HUB_CONNECT_LIMITS.maxWrongVerifiers).toBe(5);
    expect(HUB_CONNECT_LIMITS.requestTtlSeconds).toBe(600);
    expect(HUB_CONNECT_LIMITS.startsPerHour).toBe(10);
    expect(HUB_CONNECT_LIMITS.pollIntervalSeconds).toBe(3);
    // Enforced a little below what is advertised, never above it.
    expect(HUB_CONNECT_LIMITS.minPollGapMs).toBeLessThanOrEqual(HUB_CONNECT_LIMITS.pollIntervalSeconds * 1000);
    expect(HUB_CONNECT_LIMITS.minPollGapMs).toBeGreaterThan(0);
  });

  it("ends a request on the fifth wrong attempt, not the sixth", () => {
    expect(isLastWrongAttempt(3, 5)).toBe(false);
    expect(isLastWrongAttempt(4, 5)).toBe(true);
  });

  it("calls a poll too soon only inside the enforced gap", () => {
    const now = new Date("2026-09-20T12:00:10Z");
    expect(isPolledTooSoon(null, now)).toBe(false);
    expect(isPolledTooSoon("2026-09-20T12:00:09Z", now)).toBe(true);
    expect(isPolledTooSoon("2026-09-20T12:00:08Z", now)).toBe(false);
    expect(isPolledTooSoon("2026-09-20T12:00:07Z", now)).toBe(false);
  });

  it("grants what a hand-made key for a hub carries today", () => {
    expect([...HUB_GRANT_SCOPES]).toEqual(
      "profile notes contacts actions graph media stats world lexicon collections".split(" "),
    );
  });
});

describe("error codes", () => {
  it("map to the HTTP statuses of the contract", () => {
    const statuses = Object.fromEntries(Object.entries(HUB_CONNECT_ERRORS).map(([code, e]) => [code, e.status]));
    expect(statuses).toMatchObject({
      invalid_grant: 400,
      revoked: 401,
      access_denied: 403,
      not_found: 404,
      expired_token: 410,
      authorization_pending: 428,
      slow_down: 429,
    });
  });

  it("carry a plain message each, with none of the words the house style bans", () => {
    for (const { message } of Object.values(HUB_CONNECT_ERRORS)) {
      expect(message.length).toBeGreaterThan(10);
      expect(message).not.toMatch(/\u2014/);
    }
  });
});

describe("what the hub sends", () => {
  const valid = {
    hub_id: "0B4F0B52-5A0B-4A7B-9C0E-3D7C1E2F4A55",
    hub_name: "  Michael's\u0000 hub \n",
    device_id: "7d3c1d0e-64a0-4c58-8f2a-1b9e6f0c2d11",
    device_name: "Laptop",
    code_challenge: RFC_CHALLENGE,
    code_challenge_method: "S256",
    flow: "device",
    wants: { context: true, documents: true, anything: "else" },
  };

  it("accepts a well-formed /start and tidies it", () => {
    const { request, problem } = parseStartRequest(valid);
    expect(problem).toBeNull();
    expect(request).toEqual({
      hubId: "0b4f0b52-5a0b-4a7b-9c0e-3d7c1e2f4a55",
      hubName: "Michael's hub",
      deviceId: "7d3c1d0e-64a0-4c58-8f2a-1b9e6f0c2d11",
      deviceName: "Laptop",
      codeChallenge: RFC_CHALLENGE,
      flow: "device",
      wants: { context: true, documents: true },
    });
  });

  it("names the first thing wrong with a /start", () => {
    const broken: Array<[Record<string, unknown>, RegExp]> = [
      [{ ...valid, hub_id: "nope" }, /hub_id/],
      [{ ...valid, device_id: undefined }, /device_id/],
      [{ ...valid, hub_name: " \n " }, /hub_name/],
      [{ ...valid, device_name: 7 }, /device_name/],
      [{ ...valid, code_challenge_method: "plain" }, /S256/],
      [{ ...valid, code_challenge: "abc" }, /code_challenge/],
      [{ ...valid, flow: "carrier-pigeon" }, /flow/],
    ];
    for (const [body, pattern] of broken) {
      const { request, problem } = parseStartRequest(body);
      expect(request).toBeNull();
      expect(problem).toMatch(pattern);
    }
  });

  it("defaults the flow to browser and documents to off", () => {
    const { request } = parseStartRequest({ ...valid, flow: undefined, wants: undefined });
    expect(request?.flow).toBe("browser");
    expect(request?.wants).toEqual({ context: true, documents: false });
    expect(normalizeWants({ documents: "yes" })).toEqual({ context: true, documents: false });
  });

  it("cuts a name to a line and drops characters that hide or reorder text", () => {
    expect(cleanDisplayName("x".repeat(200))).toHaveLength(80);
    expect(cleanDisplayName("safe\u202eevil")).toBe("safe evil");
    expect(cleanDisplayName("\u200b")).toBeNull();
  });

  it("reads the X-Hub-* headers and drops what is malformed", () => {
    const headers = (h: Record<string, string>) => (name: string) => h[name] ?? null;
    expect(parseContactHeaders(headers({
      "x-hub-device-id": "7D3C1D0E-64A0-4C58-8F2A-1B9E6F0C2D11",
      "x-hub-device-name": " Laptop ",
      "x-hub-client": "Claude-Code",
      "x-hub-client-state": "working",
    }))).toEqual({
      deviceId: "7d3c1d0e-64a0-4c58-8f2a-1b9e6f0c2d11",
      deviceName: "Laptop",
      client: "claude-code",
      clientState: "working",
    });
    expect(parseContactHeaders(headers({
      "x-hub-device-id": "laptop",
      "x-hub-client": "<script>",
      "x-hub-client-state": "working",
    }))).toEqual({ deviceId: null, deviceName: null, client: null, clientState: null });
    expect(parseContactHeaders(headers({ "x-hub-client": "codex", "x-hub-client-state": "thriving" })).clientState).toBeNull();
    expect([...CLIENT_STATES]).toEqual(["received", "configured", "working", "waiting", "failed"]);
  });
});

describe("the caller's address", () => {
  const headers = (h: Record<string, string>) => (name: string) => h[name] ?? null;

  it("prefers the header the network edge sets over the one the caller can", () => {
    expect(callerAddress(headers({ "cf-connecting-ip": "203.0.113.7", "x-forwarded-for": "10.0.0.1" }))).toBe("203.0.113.7");
    expect(callerAddress(headers({ "x-forwarded-for": "198.51.100.4, 10.0.0.1" }))).toBe("198.51.100.4");
    expect(callerAddress(headers({}))).toBe("unknown");
  });

  it("is stored as a keyed hash, never as the address", async () => {
    const a = await hashCallerAddress("203.0.113.7", "secret-one");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toContain("203");
    expect(await hashCallerAddress("203.0.113.7", "secret-one")).toBe(a);
    expect(await hashCallerAddress("203.0.113.8", "secret-one")).not.toBe(a);
    expect(await hashCallerAddress("203.0.113.7", "secret-two")).not.toBe(a);
    // Not the bare digest anyone could compute.
    expect(a).not.toBe(await sha256Hex("203.0.113.7"));
  });
});

describe("the links /start returns", () => {
  it("carry the request and the code, and only those", () => {
    const uris = verificationUris("https://menerio.com/", "7d3c1d0e-64a0-4c58-8f2a-1b9e6f0c2d11", "BCDF-GHJK");
    expect(uris.verification_uri).toBe("https://menerio.com/connect-hub");
    expect(uris.verification_uri_complete).toBe(
      "https://menerio.com/connect-hub?request=7d3c1d0e-64a0-4c58-8f2a-1b9e6f0c2d11&code=BCDF-GHJK",
    );
  });
});

describe("minting a key", () => {
  it("makes mnr_ plus 48 hex characters, a 12 character prefix, and the SHA-256 that is stored", async () => {
    const minted = await mintHubKey();
    expect(minted.fullKey).toMatch(/^mnr_[0-9a-f]{48}$/);
    expect(minted.keyPrefix).toBe(minted.fullKey.slice(0, 12));
    expect(minted.keyHash).toBe(await sha256Hex(minted.fullKey));
    expect((await mintHubKey()).fullKey).not.toBe(minted.fullKey);
  });
});
