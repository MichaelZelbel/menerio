import { readFileSync } from "node:fs";
import { createHash, webcrypto } from "node:crypto";
import ts from "typescript";
import { z } from "zod";
import { describe, expect, it, vi } from "vitest";
import * as normalization from "../profile-normalization.ts";
import { runChat, resolveConfig } from "../llm-router.ts";

vi.mock("../llm-router.ts", () => ({
  runChat: vi.fn(async () => ({ content: '{"groups":[]}' })),
  resolveConfig: vi.fn(async (_db, _site, defaults) => ({ effective: defaults })),
}));
Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });
const owner = "11111111-1111-4111-8111-111111111111";

// Real HTTP entrypoints and shared normalization, with in-memory database,
// authentication and provider boundaries only. No external services are used.
function fixture(endpoint = "normalize-profile", options: { extraPass?: boolean; jobs?: boolean } = {}) {
  const entries = [
    { id: "1", category_id: "c", contact_id: null, label: "Favorite painting", value: "Sunrise", created_at: "2026-01-01" },
    { id: "2", category_id: "c", contact_id: null, label: "Favorite poem", value: "Evening", created_at: "2026-01-02" },
  ];
  let state: any = { id: "run", subject_type: "owner", contact_id: null, status: "completed", completed_at: "2026-09-01", input_hash: createHash("sha256").update(JSON.stringify(entries)).digest("hex") };
  const results = new Map<string, unknown>();
  const queries: Array<{ table: string; filters: unknown[][]; head?: boolean }> = [];
  const rpc = vi.fn(async (name: string, p: any) => {
    const key = `${p.p_user_id}:${p.p_contact_id}:${p.p_fingerprint}`;
    if (name === "claim_profile_normalization_input") return { data: { lease_id: "lease", cached: !p.p_manual && results.has(key), result: results.get(key) }, error: null };
    if (name === "stage_profile_normalization_input") results.set(key, p.p_result);
    return { data: true, error: null };
  });
  const db = { rpc, from: (table: string) => {
    const record = { table, filters: [] as unknown[][], head: false };
    queries.push(record);
    let single = false;
    let patch: any;
    const q: any = new Proxy({}, { get: (_t, method) => {
      if (method === "then") return (resolve: any, reject: any) => {
        if (table === "profile_normalization_runs" && patch) state = { ...state, ...patch };
        let data: any = table === "profile_entries" ? structuredClone(entries)
          : table === "profile_categories" ? [{ id: "c", slug: "hobbies" }]
          : table === "profile_normalization_runs" ? [state]
          : table === "profile_normalization_jobs" && options.jobs ? [{ id: "job", user_id: owner, contact_id: null, attempts: 0 }]
          : [];
        if (single) data = data[0] ?? null;
        return Promise.resolve({ data, error: null, count: 0 }).then(resolve, reject);
      };
      return (...args: any[]) => {
        if (method === "maybeSingle" || method === "single") single = true;
        if (method === "update" || method === "insert") patch = args[0];
        if (method === "select") record.head = args[1]?.head === true;
        if (["eq", "is", "gt", "in"].includes(String(method))) record.filters.push([method, ...args]);
        return q;
      };
    } });
    return q;
  } };
  const calls = vi.fn(async (args: any) => {
    const result = await normalization.createNormalizationSuggestions(args);
    // Simulate one deterministic mutation requiring an internal follow-up pass,
    // while still executing the real paid fingerprint/claim on both passes.
    if (options.extraPass && calls.mock.calls.length === 1) return { ...result, planned: 1, applied: 1 };
    return result;
  });
  let handler!: (req: Request) => Promise<Response>;
  const background: Promise<unknown>[] = [];
  const bindings = {
    ...normalization, z, createNormalizationSuggestions: calls,
    serve: (fn: typeof handler) => { handler = fn; },
    createClient: (_url: string, key: string) => key === "fixture-anon"
      ? { auth: { getUser: async (token: string) => ({ data: { user: token === "fixture-user" ? { id: owner } : null }, error: null }) } } : db,
    isValidCronRequest: async (req: Request) => req.headers.get("x-cron-key") === "fixture-cron",
    Deno: { env: { get: (key: string) => ({ SUPABASE_URL: "https://fixture.invalid", SUPABASE_SERVICE_ROLE_KEY: "fixture-service", SUPABASE_ANON_KEY: "fixture-anon", BRAIN_OWNER_USER_ID: owner }[key]) } },
    EdgeRuntime: { waitUntil: (p: Promise<unknown>) => background.push(p) },
  };
  const source = readFileSync(`supabase/functions/${endpoint}/index.ts`, "utf8").replace(/^import[\s\S]*?from\s+["'][^"']+["'];\s*/gm, "");
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  new Function(...Object.keys(bindings), code)(...Object.values(bindings));
  return { calls, rpc, queries, results, request: async (body: any = {}, headers: Record<string, string> = { Authorization: "Bearer fixture-user" }) => {
    const response = await handler(new Request("https://fixture.invalid/normalize", { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify({ action: "backfill", scope: "owner", includeNotesContext: false, ...body }) }));
    await Promise.all(background.splice(0));
    return response;
  } };
}

describe("normalization caller fingerprint wiring", () => {
  it.each([false, true])("scheduled maintenance stays queue-only and never pays (queued=%s)", async (jobs) => {
    vi.mocked(runChat).mockClear();
    const f = fixture("admin-normalize", { jobs });
    const response = await f.request({ cron: "profile-normalization", scope: undefined, deterministic_only: false, process_jobs: false, changed_only: false, force: true }, { "x-cron-key": "fixture-cron" });
    expect(response.status).toBe(200);
    expect((await response.json()).subjectCount).toBe(jobs ? 1 : 0);
    expect(f.calls).toHaveBeenCalledTimes(jobs ? 1 : 0);
    if (jobs) expect(f.calls.mock.calls[0][0]).toMatchObject({ userId: owner, contactId: null, deterministicOnly: true });
    expect(runChat).not.toHaveBeenCalled();
    expect(f.rpc).not.toHaveBeenCalled();
    expect(f.queries.some(q => q.table === "contacts")).toBe(false);
    const jobRead = f.queries.find(q => q.table === "profile_normalization_jobs")!;
    expect(jobRead.filters).toContainEqual(["eq", "user_id", owner]);
    for (const q of f.queries.filter(q => q.table === "profile_entries")) {
      expect(q.filters).toContainEqual(["eq", "user_id", owner]);
      expect(q.filters).toContainEqual(["is", "contact_id", null]);
    }
  });
  it("retains the timestamp optimization for deterministic maintenance", async () => {
    const f = fixture("admin-normalize");
    const response = await f.request({ deterministic_only: true, process_jobs: false }, { Authorization: "Bearer fixture-service" });
    expect((await response.json()).skippedUnchanged).toBe(1);
    expect(f.calls).not.toHaveBeenCalled();
    expect(f.queries.some(q => q.head)).toBe(true);
  });
  it("uses the authenticated owner instead of a body-supplied account", async () => {
    const f = fixture();
    expect((await f.request({ user_id: "other-account" })).status).toBe(202);
    expect(f.calls.mock.calls[0][0].userId).toBe(owner);
    for (const q of f.queries.filter(q => q.table === "profile_entries")) expect(q.filters).toContainEqual(["eq", "user_id", owner]);
    expect(f.rpc.mock.calls.every(([, args]) => args.p_user_id === owner)).toBe(true);
  });
  it("rejects another account's contact before any normalization", async () => {
    const f = fixture();
    expect((await f.request({ scope: "contact", contact_id: "other-contact" })).status).toBe(404);
    expect(f.calls).not.toHaveBeenCalled();
    expect(f.queries.find(q => q.table === "contacts")?.filters).toContainEqual(["eq", "user_id", owner]);
  });
  it.each(["normalize-profile", "admin-normalize"])("rejects an invalid credential at %s", async (endpoint) => {
    const f = fixture(endpoint);
    expect((await f.request({}, { Authorization: "Bearer invalid" })).status).toBe(endpoint === "normalize-profile" ? 401 : 403);
    expect(f.calls).not.toHaveBeenCalled();
    expect(f.queries).toHaveLength(0);
  });
  it("does not let cron credentials choose another account or a broad scope", async () => {
    const f = fixture("admin-normalize");
    expect((await f.request({ cron: "profile-normalization", scope: "all", user_id: "other-account" }, { "x-cron-key": "fixture-cron" })).status).toBe(403);
    expect(f.queries).toHaveLength(0);
    expect(f.calls).not.toHaveBeenCalled();
  });
  it("paid admin requests reach shared config identity despite unchanged timestamps", async () => {
    vi.mocked(runChat).mockClear();
    const f = fixture("admin-normalize");
    const headers = { Authorization: "Bearer fixture-service" };
    const body = { scope: "owner", process_jobs: false, changed_only: true };
    expect((await f.request(body, headers)).status).toBe(202);
    expect(runChat).toHaveBeenCalledTimes(1);
    await f.request(body, headers);
    expect(runChat).toHaveBeenCalledTimes(1);
    vi.mocked(resolveConfig).mockResolvedValueOnce({ effective: { model: "fixture-upgrade", system_prompt: "Revised fixture schema" } } as any);
    await f.request(body, headers);
    expect(runChat).toHaveBeenCalledTimes(2);
    expect(f.calls).toHaveBeenCalledTimes(3);
    expect(f.queries.some(q => q.head)).toBe(false);
  });
  it("forces only the first internal backfill pass through the real shared manual claim", async () => {
    vi.mocked(runChat).mockClear();
    const f = fixture("normalize-profile", { extraPass: true });
    await f.request({ force: true });
    expect(f.calls.mock.calls.map(([args]) => args.manual)).toEqual([true, false]);
    expect(runChat).toHaveBeenCalledTimes(1);
    await f.request({ force: true });
    expect(runChat).toHaveBeenCalledTimes(2);
    expect(f.rpc.mock.calls.filter(([name]) => name === "claim_profile_normalization_input").map(([, args]) => args.p_manual)).toEqual([true, false, true]);
  });
  it("backfill reaches the shared decision for unchanged legacy facts and a changed config, then deduplicates", async () => {
    vi.mocked(runChat).mockClear();
    const f = fixture();
    expect((await f.request()).status).toBe(202);
    expect(runChat).toHaveBeenCalledTimes(1);
    await f.request();
    expect(runChat).toHaveBeenCalledTimes(1);
    vi.mocked(resolveConfig).mockResolvedValueOnce({ effective: { model: "fixture-upgrade", system_prompt: "Revised fixture schema" } } as any);
    await f.request();
    expect(runChat).toHaveBeenCalledTimes(2);
    expect(f.calls).toHaveBeenCalledTimes(3);
    expect(f.rpc.mock.calls.filter(([name]) => name === "claim_profile_normalization_input").every(([, args]) => args.p_manual === false)).toBe(true);
  });
});
