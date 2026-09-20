// @vitest-environment node
import { beforeAll, describe, expect, it } from "vitest";
import { build } from "esbuild";
import { memoryDb, type Row } from "./memory-db";
import { sha256Hex } from "../sha256.ts";

/**
 * lookupHubKey is the one function in front of the MCP server and every
 * hub-api-* function. Two things have to hold at once: a key that belongs to no
 * hub connection is read exactly as it always was, and a key that does belong
 * to one works only while that connection is active and of the key's generation.
 *
 * The real hub-auth.ts is bundled (its supabase import stubbed out, since the
 * client is handed in) and run against the in-memory database.
 */

type Lookup = (key: string, admin: unknown) => Promise<{
  result: { userId: string; scopes: string[]; keyId: string; connectionId: string | null } | null;
  errorMessage: string | null;
  errorCode: string | null;
}>;

let lookupHubKey: Lookup;

beforeAll(async () => {
  const bundle = await build({
    entryPoints: ["supabase/functions/_shared/hub-auth.ts"], bundle: true, write: false, platform: "node", format: "esm",
    plugins: [{
      name: "no-remote-client", setup(b) {
        b.onResolve({ filter: /^https:\/\/esm.sh\/@supabase/ }, (args) => ({ path: args.path, namespace: "fake" }));
        b.onLoad({ filter: /.*/, namespace: "fake" }, () => ({
          contents: "export const createClient = () => { throw new Error('the test hands the client in') }", loader: "js",
        }));
      },
    }],
  });
  const source = Buffer.from(bundle.outputFiles[0].text).toString("base64");
  ({ lookupHubKey } = await import(/* @vite-ignore */ `data:text/javascript;base64,${source}`));
});

const LEGACY = "mnr_" + "a".repeat(48);
const GRANT = "mnr_" + "b".repeat(48);
const OLD_GRANT = "mnr_" + "c".repeat(48);

async function database(overrides: { connection?: Row; grant?: Row; legacy?: Row } = {}) {
  return memoryDb({
    hub_api_keys: [
      { id: "key-legacy", user_id: "user-a", key_hash: await sha256Hex(LEGACY), scopes: ["notes"], is_active: true, expires_at: null, hub_connection_id: null, generation: null, ...overrides.legacy },
      { id: "key-grant", user_id: "user-a", key_hash: await sha256Hex(GRANT), scopes: ["notes", "profile"], is_active: true, expires_at: null, hub_connection_id: "conn-a", generation: 2, ...overrides.grant },
      { id: "key-old", user_id: "user-a", key_hash: await sha256Hex(OLD_GRANT), scopes: ["notes"], is_active: true, expires_at: null, hub_connection_id: "conn-a", generation: 1 },
    ],
    hub_connections: [
      { id: "conn-a", user_id: "user-a", status: "active", generation: 2, ...overrides.connection },
      { id: "conn-b", user_id: "user-b", status: "active", generation: 2 },
    ],
  });
}

/** Counts reads per table, so "one extra query, and only for a connected key" is a fact. */
function counting(db: ReturnType<typeof memoryDb>) {
  const reads: Record<string, number> = {};
  return {
    reads,
    client: {
      from(table: string) {
        const q = db.from(table);
        const select = q.select;
        q.select = (...args: unknown[]) => { reads[table] = (reads[table] ?? 0) + 1; return select(...args); };
        return q;
      },
    },
  };
}

describe("a key that belongs to no connection", () => {
  it("is accepted exactly as before, without a second query", async () => {
    const { client, reads } = counting(await database());
    const { result, errorMessage, errorCode } = await lookupHubKey(LEGACY, client);
    expect(result).toEqual({ userId: "user-a", scopes: ["notes"], keyId: "key-legacy", connectionId: null });
    expect(errorMessage).toBeNull();
    expect(errorCode).toBeNull();
    expect(reads).toEqual({ hub_api_keys: 1 });
  });

  it("keeps its old refusals, word for word", async () => {
    expect((await lookupHubKey("not-a-key", (await database()))).errorMessage)
      .toBe("Missing or invalid API key. Expected 'Bearer mnr_...' header.");
    expect((await lookupHubKey("mnr_" + "f".repeat(48), await database())).errorMessage).toBe("Invalid API key.");
    expect((await lookupHubKey(LEGACY, await database({ legacy: { is_active: false } }))).errorMessage)
      .toBe("API key has been revoked.");
    expect((await lookupHubKey(LEGACY, await database({ legacy: { expires_at: "2020-01-01T00:00:00Z" } }))).errorMessage)
      .toBe("API key has expired.");
  });

  it("is untouched by whatever happens to a hub connection of the same account", async () => {
    const db = await database({ connection: { status: "revoked" } });
    expect((await lookupHubKey(LEGACY, db)).result?.keyId).toBe("key-legacy");
  });

  it("still works on a database that does not have the connection columns yet", async () => {
    const db = await database();
    let asked = 0;
    const client = {
      from(table: string) {
        const q = db.from(table);
        const select = q.select;
        q.select = (columns: string) => {
          asked++;
          if (columns.includes("hub_connection_id")) {
            const refusal = { data: null, error: { code: "42703", message: "column hub_api_keys.hub_connection_id does not exist" } };
            const dead: Row = { eq: () => dead, maybeSingle: () => dead, then: (ok: (v: unknown) => unknown) => Promise.resolve(ok(refusal)) };
            return dead;
          }
          return select(columns);
        };
        return q;
      },
    };
    const { result } = await lookupHubKey(LEGACY, client);
    expect(result).toMatchObject({ userId: "user-a", keyId: "key-legacy", connectionId: null });
    expect(asked).toBe(2);
  });
});

describe("a key minted for a hub connection", () => {
  it("is accepted while the connection is active and of its generation, at the cost of one query", async () => {
    const { client, reads } = counting(await database());
    const { result } = await lookupHubKey(GRANT, client);
    expect(result).toEqual({ userId: "user-a", scopes: ["notes", "profile"], keyId: "key-grant", connectionId: "conn-a" });
    expect(reads).toEqual({ hub_api_keys: 1, hub_connections: 1 });
  });

  it("is refused once the hub was connected again, even if it was never switched off", async () => {
    const { result, errorMessage, errorCode } = await lookupHubKey(OLD_GRANT, await database());
    expect(result).toBeNull();
    expect(errorMessage).toBe("This hub's connection to Menerio was ended.");
    expect(errorCode).toBe("connection_ended");
  });

  it("is refused once the connection was ended", async () => {
    const lookup = await lookupHubKey(GRANT, await database({ connection: { status: "revoked" } }));
    expect(lookup.result).toBeNull();
    expect(lookup.errorMessage).toBe("This hub's connection to Menerio was ended.");
  });

  it("names the connection, not the key, when the key itself was switched off", async () => {
    const lookup = await lookupHubKey(GRANT, await database({ grant: { is_active: false } }));
    expect(lookup.errorMessage).toBe("This hub's connection to Menerio was ended.");
    expect(lookup.errorCode).toBe("connection_ended");
  });

  it("cannot borrow another account's connection", async () => {
    const lookup = await lookupHubKey(GRANT, await database({ grant: { hub_connection_id: "conn-b" } }));
    expect(lookup.result).toBeNull();
    expect(lookup.errorCode).toBe("connection_ended");
  });

  it("is refused when the connection is gone altogether", async () => {
    const lookup = await lookupHubKey(GRANT, await database({ grant: { hub_connection_id: "conn-missing" } }));
    expect(lookup.result).toBeNull();
  });

  it("says 'try again', not 'ended', when the connection could not be read", async () => {
    const db = await database();
    const client = {
      from(table: string) {
        if (table !== "hub_connections") return db.from(table);
        const refusal = { data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } };
        const dead: Row = { select: () => dead, eq: () => dead, maybeSingle: () => dead, then: (ok: (v: unknown) => unknown) => Promise.resolve(ok(refusal)) };
        return dead;
      },
    };
    const lookup = await lookupHubKey(GRANT, client);
    expect(lookup.result).toBeNull();
    expect(lookup.errorCode).toBe("unavailable");
    expect(lookup.errorMessage).not.toMatch(/ended/);
  });
});
