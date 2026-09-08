// @vitest-environment node
import { describe, expect, it } from "vitest";
import { build } from "esbuild";
import vm from "node:vm";
import { webcrypto } from "node:crypto";


interface QueryState { table: string; action: string; from: number; filters: Record<string, unknown>; single?: boolean; values?: Record<string, unknown> }
interface LeaseArgs { p_action: string; p_user: string; p_success: boolean }
interface MockQuery {
 select(): MockQuery; order(): MockQuery; in(): MockQuery; range(from:number):MockQuery;
 eq(key:string,value:unknown):MockQuery; is():MockQuery; single():MockQuery;
 update(values:Record<string,unknown>):MockQuery; insert(values:Record<string,unknown>):MockQuery;
 then(ok:(value:unknown)=>unknown,fail:(reason:unknown)=>unknown):Promise<unknown>;
}
type FetchInit = RequestInit & { headers: Record<string,string> };

async function harness(options: { status?: number; partial?: boolean; foreign?: boolean; timeout?: boolean; auth?: boolean; busy?: boolean; endpoint?: string } = {}) {
  const writes: QueryState[] = [], calls: QueryState[] = [], leases: LeaseArgs[] = [];
  const connection = { id: "connection-a", user_id: "user-a", github_token: "github-only", repo_owner: "synthetic", repo_name: "vault", branch: "main", sync_direction: "import", sync_people: false };
  const client = {
    auth: { getClaims: async () => options.auth === false ? { error: true } : { data: { claims: { sub: "user-a" } } } },
    rpc: async (name: string, args: LeaseArgs) => {
      if (name === "get_cron_secret") return { data: "cron-secret" };
      leases.push(args);
      return { data: !options.busy };
    },
    from(table: string) {
      const state: QueryState = { table, action: "select", from: 0, filters: {} };
      const query: MockQuery = {
        select: () => query, order: () => query, in: () => query,
        range: (from: number) => { state.from = from; return query; },
        eq: (key: string, value: unknown) => { state.filters[key] = value; return query; },
        is: () => query,
        single: () => { state.single = true; return query; },
        update: (values: Record<string,unknown>) => { state.action = "update"; state.values = values; return query; },
        insert: (values: Record<string,unknown>) => { state.action = "insert"; state.values = values; return query; },
        then: (ok: (value:unknown)=>unknown, fail: (reason:unknown)=>unknown) => Promise.resolve().then(() => {
          calls.push(state);
          if (state.action !== "select") {
            writes.push(state);
            return { data: null, error: { code: "40001", message: "Synthetic failed import" } };
          }
          if (options.foreign && table === "github_sync_log") return { data: state.from === 0 ? [{ id: "log", note_id: "foreign-note", github_path: "note.md", github_sha: "old" }] : [], error: null };
          if (options.foreign && table === "notes" && state.single) return { data: state.filters.user_id === "user-a" ? null : { id: "foreign-note", title: "Private", updated_at: "2026-01-01" }, error: null };
          return { data: table === "github_connections" ? state.single ? connection : state.from === 0 ? [connection] : [] : [], error: null };
        }).then(ok, fail),
      };
      return query;
    },
  };
  const bundle = await build({ entryPoints: [`supabase/functions/${options.endpoint || "github-sync-scheduled"}/index.ts`], bundle: true, write: false, platform: "node", format: "cjs", plugins: [{
    name: "synthetic-database", setup(b) {
      b.onResolve({ filter: /^https:\/\/esm.sh\/@supabase/ }, args => ({ path: args.path, namespace: "fake" }));
      b.onLoad({ filter: /.*/, namespace: "fake" }, () => ({ contents: "export const createClient = () => globalThis.testClient", loader: "js" }));
    },
  }] });
  const fetches: {url:string;init:FetchInit}[] = [];
  let handler: (req:Request)=>Promise<Response>;
  vm.runInNewContext(bundle.outputFiles[0].text, {
    testClient: client, console, Request, Response, URL, AbortSignal, TextEncoder, crypto: webcrypto,
    setInterval, clearInterval, btoa, atob,
    fetch: async (url: string, init: FetchInit) => {
      fetches.push({ url, init });
      if (options.timeout) throw new DOMException("Synthetic timeout", "TimeoutError");
      if (options.status) return new Response("Synthetic GitHub refusal", { status: options.status });
      if (url.includes("/git/trees/")) return Response.json({ tree: options.partial || options.foreign ? [{ type: "blob", path: "note.md", sha: "one" }] : [] });
      if (url.includes("/contents/")) return Response.json({ content: btoa("Synthetic imported content"), sha: "one" });
      return Response.json({ name: "vault" });
    },
    Deno: { env: { get: (key: string) => ({ SUPABASE_URL: "https://synthetic.invalid", SUPABASE_SERVICE_ROLE_KEY: "service-key", SUPABASE_ANON_KEY: "anon-key" })[key] }, serve: (fn: (req:Request)=>Promise<Response>) => { handler = fn; } },
  });
  return { writes, calls, leases, fetches, invoke: (authorization = "Bearer service-key", body: Record<string,unknown> = {}) => handler(new Request("https://synthetic.invalid/sync", { method: "POST", headers: { Authorization: authorization }, body: JSON.stringify(body) })) };
}

describe("scheduled and manual entrypoints with actual shared pull", () => {
  it.each([401, 403, 429, 504])("never records success after GitHub %s", async status => {
    const h = await harness({ status });
    const result = await h.invoke();
    expect(result.status).toBe(502);
    expect((await result.json()).success).toBe(false);
    expect(h.leases.find(x => x.p_action === "finish").p_success).toBe(false);
    expect(h.fetches.every(x => x.url.startsWith("https://api.github.com/") && x.init.headers.Authorization === "token github-only")).toBe(true);
  });
  it("records a completed no-change pull", async () => {
    const h = await harness();
    expect((await h.invoke()).status).toBe(200);
    expect(h.leases.find(x => x.p_action === "finish").p_success).toBe(true);
  });
  it("rejects a sync log pointing at another owner's note", async () => {
    const h = await harness({ foreign: true });
    expect((await h.invoke()).status).toBe(502);
    expect(h.calls.find(x => x.table === "notes" && x.single).filters.user_id).toBe("user-a");
    expect(h.writes).toEqual([]);
  });
  it("releases a timed-out pull without success", async () => {
    const h = await harness({ timeout: true });
    expect((await h.invoke()).status).toBe(502);
    expect(h.leases.find(x => x.p_action === "finish").p_success).toBe(false);
    expect(h.fetches[0].init.signal).toBeDefined();
  });
  it("records partial import failure without advancing success", async () => {
    const h = await harness({ partial: true });
    expect((await h.invoke()).status).toBe(502);
    expect(h.writes.some(x => x.table === "notes")).toBe(true);
    expect(h.leases.find(x => x.p_action === "finish").p_success).toBe(false);
  });
  it("rejects missing or invalid user authorization before reading connections", async () => {
    const h = await harness({ auth: false });
    expect((await h.invoke("")).status).toBe(401);
    expect((await h.invoke("Bearer invalid")).status).toBe(401);
    expect(h.calls).toEqual([]);
  });
  it.each(["github-sync-scheduled", "github-sync-pull"])("%s ignores a supplied foreign owner", async endpoint => {
    const h = await harness({ endpoint });
    expect((await h.invoke("Bearer user-token", { user_id: "user-b" })).status).toBe(200);
    expect(h.calls.filter(x => x.table === "github_connections").every(x => x.filters.user_id === "user-a")).toBe(true);
    expect(h.leases.every(x => x.p_user === "user-a")).toBe(true);
  });
  it("does not start another pull while a lease is held", async () => {
    const h = await harness({ busy: true });
    expect((await h.invoke()).status).toBe(502);
    expect(h.fetches).toEqual([]);
  });
});
