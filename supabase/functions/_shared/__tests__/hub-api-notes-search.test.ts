// @vitest-environment node
import { describe, expect, it } from "vitest";
import { build } from "esbuild";
import vm from "node:vm";
import { webcrypto } from "node:crypto";
import type { Row } from "./memory-db";

/**
 * GET /hub-api-notes/search, run as the deployed function: the real index.ts is
 * bundled and served, only the database client and the network are synthetic.
 */


interface Options {
  /** Remaining tokens in the key owner's allowance. 0 means exhausted. */
  tokens?: number;
  /** HTTP status the embedding provider answers with. */
  providerStatus?: number;
}

async function harness(options: Options = {}) {
  const notes: Row[] = [
    { id: "native-1", user_id: "user-a", title: "Dentist", content: "Root canal booked for March.", tags: [], entity_type: null, is_favorite: false, is_pinned: false, is_trashed: false, folder_path: "Health", source_app: "web", source_id: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-02-01T00:00:00Z" },
    { id: "hub-1", user_id: "user-a", title: "observations/teeth.md", content: "He has a root canal coming up.", tags: [], entity_type: null, is_favorite: false, is_pinned: false, is_trashed: false, folder_path: "hub/observations", source_app: "hub", source_id: "observations/teeth.md", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-03-01T00:00:00Z" },
    { id: "foreign", user_id: "user-b", title: "Root canal", content: "root canal", tags: [], is_trashed: false, folder_path: "", source_app: "web", source_id: null, updated_at: "2026-03-02T00:00:00Z" },
  ];
  const rpcs: { name: string; args: Row }[] = [];
  const client = {
    async rpc(name: string, args: Row) {
      rpcs.push({ name, args });
      if (name === "hub_api_bump_usage") return { data: [{ allowed: true }], error: null };
      if (name === "deduct_ai_tokens_attributed") return { data: { allowed: true, remaining_tokens: 1, remaining_credits: 1 }, error: null };
      if (name === "match_note_chunks") {
        return { data: [
          { note_id: "hub-1", similarity: 0.82, content: "He has a root canal coming up." },
          { note_id: "native-1", similarity: 0.55, content: "Root canal booked for March." },
        ], error: null };
      }
      return { data: null, error: { message: `unexpected rpc ${name}` } };
    },
    from(table: string) {
      let rows: Row[] =
        table === "hub_api_keys" ? [{ id: "key-1", user_id: "user-a", scopes: ["notes"], is_active: true, expires_at: null }]
        : table === "v_ai_allowance_current" ? [{ user_id: "user-a", remaining_tokens: options.tokens ?? 1_000_000, remaining_credits: 10, period_start: "2026-09-01" }]
        : table === "notes" ? [...notes]
        : [];
      let single = false;
      const q: Row = {
        select: () => q, update: () => q, order: () => q,
        eq: (k: string, v: unknown) => { if (k !== "key_hash") rows = rows.filter((r) => r[k] === v); return q; },
        in: (k: string, vs: unknown[]) => { rows = rows.filter((r) => vs.includes(r[k])); return q; },
        ilike: (k: string, v: string) => { rows = rows.filter((r) => String(r[k] ?? "").toLowerCase() === v.toLowerCase()); return q; },
        or: (expr: string) => {
          if (expr.startsWith("source_app.is.null")) rows = rows.filter((r) => String(r.source_app ?? "").toLowerCase() !== "hub");
          else {
            const needle = (/ilike\."%(.*?)%"/.exec(expr)?.[1] ?? "").toLowerCase();
            rows = rows.filter((r) => `${r.title}\n${r.content}`.toLowerCase().includes(needle));
          }
          return q;
        },
        limit: (n: number) => { rows = rows.slice(0, n); return q; },
        maybeSingle: () => { single = true; return q; },
        then: (ok: (v: unknown) => unknown) => Promise.resolve(ok({ data: single ? rows[0] ?? null : rows, error: null })),
      };
      return q;
    },
  };

  const bundle = await build({
    entryPoints: ["supabase/functions/hub-api-notes/index.ts"], bundle: true, write: false, platform: "node", format: "cjs",
    plugins: [{
      name: "synthetic-database", setup(b) {
        b.onResolve({ filter: /^https:\/\/esm.sh\/@supabase/ }, (args) => ({ path: args.path, namespace: "fake" }));
        b.onLoad({ filter: /.*/, namespace: "fake" }, () => ({ contents: "export const createClient = () => globalThis.testClient", loader: "js" }));
      },
    }],
  });

  const fetches: string[] = [];
  let handler: (req: Request) => Promise<Response>;
  vm.runInNewContext(bundle.outputFiles[0].text, {
    testClient: client, console: { ...console, warn: () => {}, error: () => {}, log: () => {} },
    Request, Response, URL, Headers, AbortSignal, TextEncoder, crypto: webcrypto, setTimeout, clearTimeout,
    fetch: async (url: string) => {
      fetches.push(String(url));
      if (options.providerStatus) return new Response("synthetic provider failure", { status: options.providerStatus });
      return Response.json({ data: [{ embedding: [0.1, 0.2, 0.3] }], usage: { prompt_tokens: 4, total_tokens: 4 } });
    },
    Deno: {
      env: { get: (key: string) => ({ SUPABASE_URL: "https://synthetic.invalid", SUPABASE_SERVICE_ROLE_KEY: "service-key", OPENROUTER_API_KEY: "provider-key" } as Row)[key] },
      serve: (fn: (req: Request) => Promise<Response>) => { handler = fn; },
    },
  });

  return {
    rpcs, fetches,
    // The edge runtime hands the function a path that starts at its own name.
    search: (qs: string) => handler!(new Request(`https://synthetic.invalid/hub-api-notes/search?${qs}`, {
      method: "GET", headers: { Authorization: "Bearer mnr_synthetic" },
    })),
  };
}

describe("GET /hub-api-notes/search", () => {
  it("answers by meaning and by text, native note before the more similar hub file", async () => {
    const h = await harness();
    const res = await h.search("q=tooth%20appointment");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mode).toBe("semantic+text");
    expect(body.meta).toMatchObject({ query: "tooth appointment", total: 2, mode: "semantic+text" });
    expect(body.data.map((r: Row) => r.id)).toEqual(["native-1", "hub-1"]);
    expect(body.data[1]).toMatchObject({
      title: "observations/teeth.md", folder_path: "hub/observations", source_app: "hub",
      source_id: "observations/teeth.md", similarity: 0.82,
    });
    expect(body.data[1].snippet).toContain("root canal");
  });

  it("charges the embedding to the user the key belongs to", async () => {
    const h = await harness();
    await h.search("q=tooth");
    const charge = h.rpcs.find((r) => r.name === "deduct_ai_tokens_attributed")!;
    expect(charge.args.p_user_id).toBe("user-a");
    expect(charge.args.p_feature).toBe("hub-api-search:embedding");
    expect(h.rpcs.find((r) => r.name === "match_note_chunks")!.args.p_user_id).toBe("user-a");
  });

  it("never calls another edge function over HTTP", async () => {
    const h = await harness();
    await h.search("q=tooth");
    expect(h.fetches).toEqual(["https://openrouter.ai/api/v1/embeddings"]);
  });

  it("degrades to text only with no credits: 200, no provider call, no charge", async () => {
    const h = await harness({ tokens: 0 });
    const res = await h.search("q=root%20canal");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mode).toBe("text_only");
    expect(body.data.map((r: Row) => r.id)).toEqual(["native-1", "hub-1"]);
    expect(body.data.every((r: Row) => r.similarity === null)).toBe(true);
    expect(h.fetches).toEqual([]);
    expect(h.rpcs.some((r) => r.name === "deduct_ai_tokens_attributed")).toBe(false);
  });

  it("degrades to text only when the provider fails", async () => {
    const h = await harness({ providerStatus: 502 });
    const res = await h.search("q=root%20canal");
    expect(res.status).toBe(200);
    expect((await res.json()).mode).toBe("text_only");
  });

  it("filters by source_app and clamps the limit", async () => {
    const h = await harness();
    const hubOnly = await (await h.search("q=root%20canal&source_app=hub")).json();
    expect(hubOnly.data.map((r: Row) => r.id)).toEqual(["hub-1"]);
    const nativeOnly = await (await h.search("q=root%20canal&source_app=native")).json();
    expect(nativeOnly.data.map((r: Row) => r.id)).toEqual(["native-1"]);
    const one = await (await h.search("q=root%20canal&limit=1")).json();
    expect(one.data).toHaveLength(1);
    expect((await h.search("q=root%20canal&limit=all")).status).toBe(200);
  });

  it("never returns another user's note", async () => {
    const h = await harness();
    const body = await (await h.search("q=root%20canal")).json();
    expect(body.data.map((r: Row) => r.id)).not.toContain("foreign");
  });

  it("still requires q", async () => {
    const h = await harness();
    expect((await h.search("limit=5")).status).toBe(400);
  });
});
