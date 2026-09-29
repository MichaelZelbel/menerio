// @vitest-environment node
//
// Loads the real edge function into a sandbox (same technique as
// merge-contacts/__tests__/handler.test.ts) and drives it with requests signed
// by real Ed25519 keys. tweetnacl is not installed for Node, so its one call,
// `sign.detached.verify`, is backed by node:crypto.
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { createPublicKey, generateKeyPairSync, sign, verify, type KeyObject } from "node:crypto";
import { transformSync } from "esbuild";
import { describe, expect, it, vi } from "vitest";

const source = readFileSync("supabase/functions/discord-capture/index.ts", "utf8");
const code = transformSync(source, { loader: "ts", format: "cjs" }).code;

function keypair() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const raw = Buffer.from(publicKey.export({ format: "jwk" }).x as string, "base64url");
  return { privateKey, hex: raw.toString("hex") };
}

const nacl = {
  sign: {
    detached: {
      verify(msg: Uint8Array, sig: Uint8Array, key: Uint8Array): boolean {
        const pub = createPublicKey({
          key: { kty: "OKP", crv: "Ed25519", x: Buffer.from(key).toString("base64url") },
          format: "jwk",
        });
        return verify(null, Buffer.from(msg), pub, Buffer.from(sig));
      },
    },
  },
};

type Row = Record<string, unknown>;

function setup(rows: Row[], botTokenOwners: Record<string, string> = {}) {
  let handler!: (request: Request) => Promise<Response>;
  const inserts: Row[] = [];
  const db = {
    auth: { getUser: vi.fn() },
    from(table: string) {
      if (table === "discord_connections") {
        const filters: Array<[string, unknown]> = [];
        const matching = () => rows.filter((r) => filters.every(([c, v]) => r[c] === v));
        const b: any = {
          select: () => b,
          eq: (col: string, val: unknown) => (filters.push([col, val]), b),
          // PostgREST's .single(): an error unless exactly one row matches.
          single: async () => {
            const m = matching();
            return m.length === 1 ? { data: m[0], error: null } : { data: null, error: { code: "PGRST116" } };
          },
          then: (ok: any, bad: any) => Promise.resolve({ data: matching(), error: null }).then(ok, bad),
        };
        return b;
      }
      if (table === "notes") {
        return {
          insert(row: Row) {
            inserts.push(row);
            return { select: () => ({ single: async () => ({ data: { id: `note-${inserts.length}` }, error: null }) }) };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url).endsWith("/applications/@me")) {
      const token = String((init?.headers as Record<string, string>).Authorization).replace("Bot ", "");
      const app = botTokenOwners[token];
      return app
        ? new Response(JSON.stringify({ id: app }), { status: 200 })
        : new Response(JSON.stringify({ message: "401: Unauthorized" }), { status: 401 });
    }
    return new Response("{}", { status: 202 }); // process-note
  });
  const require = (spec: string) => {
    if (spec.includes("supabase-js")) return { createClient: () => db };
    if (spec.includes("tweetnacl")) return nacl;
    throw new Error(`unexpected import in discord-capture: ${spec}`);
  };
  runInNewContext(code, {
    require, Request, Response, URL, TextEncoder, AbortSignal, console, fetch,
    Deno: { env: { get: (k: string) => k }, serve: (fn: typeof handler) => { handler = fn; } },
  });
  const call = (body: unknown, privateKey: KeyObject | null) => {
    const raw = JSON.stringify(body);
    const timestamp = "1727600000";
    const signature = privateKey
      ? sign(null, Buffer.from(timestamp + raw), privateKey).toString("hex")
      : "00".repeat(64);
    return handler(new Request("https://example.test/discord-capture", {
      method: "POST",
      headers: { "x-signature-ed25519": signature, "x-signature-timestamp": timestamp },
      body: raw,
    }));
  };
  return { call, inserts, fetch };
}

const capture = (text: string) => ({
  type: 2,
  application_id: "app-A",
  guild_id: "guild-A",
  data: { name: "capture", options: [{ name: "thought", value: text }] },
});

describe("discord-capture: which account an interaction belongs to", () => {
  const owner = keypair();
  const ownerRow = {
    id: "c-owner", user_id: "owner", application_id: "app-A", public_key: owner.hex,
    discord_guild_id: "guild-A", discord_channel_id: null, bot_token: "owner-token", is_active: true,
  };
  // A second account that copied the owner's application id, public key and
  // server id into its own Settings, with a bot token of its own.
  const copyRow = { ...ownerRow, id: "c-copy", user_id: "copycat", bot_token: "copycat-token" };

  it("captures into the only account whose key signs, without asking Discord", async () => {
    const x = setup([ownerRow]);
    const res = await x.call(capture("hello"), owner.privateKey);
    expect(res.status).toBe(200);
    expect(x.inserts).toHaveLength(1);
    expect(x.inserts[0].user_id).toBe("owner");
    expect(x.fetch.mock.calls.some(([u]) => String(u).includes("applications/@me"))).toBe(false);
  });

  it("gives a copied connection nothing: the tie goes to the row whose bot token owns the app", async () => {
    for (const rows of [[copyRow, ownerRow], [ownerRow, copyRow]]) {
      const x = setup(rows, { "owner-token": "app-A", "copycat-token": "app-copycat" });
      const res = await x.call(capture("private thought"), owner.privateKey);
      expect(res.status).toBe(200);
      expect(x.inserts).toHaveLength(1);
      expect(x.inserts[0].user_id).toBe("owner");
    }
  });

  it("saves nothing when a tie cannot be settled", async () => {
    const x = setup([copyRow, ownerRow], {});
    const res = await x.call(capture("private thought"), owner.privateKey);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.type).toBe(4);
    expect(body.data.flags).toBe(64);
    expect(x.inserts).toHaveLength(0);
  });

  it("answers a PING only when a saved key signs it", async () => {
    const stranger = keypair();
    expect((await setup([]).call({ type: 1, application_id: "app-A" }, owner.privateKey)).status).toBe(401);
    expect((await setup([ownerRow]).call({ type: 1, application_id: "app-A" }, stranger.privateKey)).status).toBe(401);
    expect((await setup([ownerRow]).call({ type: 1, application_id: "app-A" }, null)).status).toBe(401);
    const pong = await setup([ownerRow]).call({ type: 1, application_id: "app-A" }, owner.privateKey);
    expect(pong.status).toBe(200);
    expect(await pong.json()).toEqual({ type: 1 });
  });

  it("refuses a forged /capture", async () => {
    const stranger = keypair();
    const x = setup([ownerRow]);
    expect((await x.call(capture("forged"), stranger.privateKey)).status).toBe(401);
    expect(x.inserts).toHaveLength(0);
  });
});
