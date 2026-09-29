import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { noteText, taggedPrompt } from "../prompt-safety";
import { selectAllRows } from "../paged-select";
import * as graphMatching from "../graph-matching";

// The real edge function bodies; only imports (network, Deno) are bound.
function load(path: string, bindings: Record<string, unknown>) {
  const source = readFileSync(path, "utf8").replace(/^import[\s\S]*?from\s+["'][^"']+["'];\s*/gm, "");
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  return new Function("exports", ...Object.keys(bindings), code)({}, ...Object.values(bindings));
}

type Query = { table: string; select?: string; action: string; filters: any[][]; range?: [number, number]; payload?: any };
/** A supabase-js stand-in: records every query, evaluates eq/neq/is, and caps an unranged read at 1,000 rows like PostgREST. */
function fakeDb(rows: (q: Query) => any, extra: Record<string, unknown> = {}) {
  const queries: Query[] = [];
  const evaluate = (q: Query, data: any) => {
    if (!Array.isArray(data)) return data;
    let out = data.filter((r) => q.filters.every(([op, col, val]) =>
      op === "eq" ? r[col] === undefined || r[col] === val
        : op === "neq" ? r[col] !== val
          : op === "is" ? r[col] === undefined || r[col] === val
            : true));
    out = q.range ? out.slice(q.range[0], Math.min(q.range[1] + 1, q.range[0] + 1000)) : out.slice(0, 1000);
    return out;
  };
  const from = (table: string) => {
    const q: Query = { table, action: "select", filters: [] };
    queries.push(q);
    const builder: any = new Proxy({}, {
      get: (_t, key) => {
        if (key === "then") {
          return (resolve: any, reject: any) => {
            const answer = rows(q) ?? { data: null, error: null };
            return Promise.resolve({ ...answer, data: evaluate(q, answer.data) }).then(resolve, reject);
          };
        }
        return (...args: any[]) => {
          const k = String(key);
          if (k === "select") { if (q.action === "select") q.select = args[0]; }
          else if (["insert", "update", "upsert", "delete"].includes(k)) { q.action = k; q.payload = args[0]; }
          else if (k === "range") q.range = [args[0], args[1]];
          else q.filters.push([k, ...args]);
          return builder;
        };
      },
    });
    return builder;
  };
  return { db: { from, ...extra }, queries };
}
const quiet = { log: () => {}, warn: () => {}, error: () => {} };
const post = (body: unknown, token = "user-token") => new Request("http://fixture", {
  method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
});

describe("compute-connections", () => {
  it("reads every other note, so an edge to a note past the first 1,000 is kept, not deleted", async () => {
    // 1,500 other notes (a mirror-sized account); only the 1,401st shares topics.
    const others = Array.from({ length: 1500 }, (_, i) => ({
      id: `n${String(i).padStart(4, "0")}`, title: `Other ${i}`, user_id: "u", is_trashed: false, ai_visibility: "visible",
      people: null, topics: i === 1400 ? ["alpha", "beta", "gamma"] : null,
    }));
    const { db, queries } = fakeDb((q) => {
      if (q.table === "notes" && q.select === "user_id") return { data: { user_id: "u" } };
      if (q.table === "notes" && q.select?.startsWith("id, user_id, title, metadata")) {
        return { data: { id: "x", user_id: "u", title: "X", metadata: { topics: ["alpha", "beta", "gamma"] }, embedding: null, ai_visibility: "visible" } };
      }
      if (q.table === "notes") return { data: others };
      if (q.table === "contacts") return { data: [] };
      if (q.table === "note_connections" && q.action === "select") {
        const type = q.filters.find((f) => f[1] === "connection_type")?.[2];
        return { data: type === "shared_topic" ? [{ id: "keep", target_note_id: "n1400" }, { id: "stale", target_note_id: "n0001" }] : [] };
      }
      return { data: null, error: null };
    });
    let handler: any;
    load("supabase/functions/compute-connections/index.ts", {
      Deno: { env: { get: (k: string) => (k === "SUPABASE_SERVICE_ROLE_KEY" ? "svc" : "") }, serve: (h: any) => { handler = h; } },
      createClient: () => db, selectAllRows, ...graphMatching, console: quiet,
    });
    const response = await handler(post({ note_id: "x" }, "svc"));
    expect(response.status).toBe(200);
    const upserted = queries.filter((q) => q.table === "note_connections" && q.action === "upsert").flatMap((q) => [q.payload].flat());
    expect(upserted).toContainEqual(expect.objectContaining({ target_note_id: "n1400", connection_type: "shared_topic" }));
    const deletes = queries.filter((q) => q.table === "note_connections" && q.action === "delete");
    expect(deletes.flatMap((q) => q.filters.find((f) => f[0] === "in")?.[2] ?? [])).toEqual(["stale"]);
    // Only the two fields matched on, never the whole metadata of every note.
    expect(queries.find((q) => q.table === "notes" && q.range)?.select).toBe("id, title, people:metadata->people, topics:metadata->topics");
  });
});

describe("find-connections", () => {
  function run(source: Record<string, unknown>, extraRows: (q: Query) => any = () => null) {
    const prompts: string[] = [];
    let embeds = 0;
    const rpcs: string[] = [];
    const { db } = fakeDb((q) => (q.table === "notes" ? { data: source } : extraRows(q)), {
      auth: { getUser: async () => ({ data: { user: { id: "u" } }, error: null }) },
      rpc: async (name: string) => {
        rpcs.push(name);
        return { data: [{ id: "m", title: "Match", similarity: 0.9, metadata: { people: ["Alice", "Bob"] }, created_at: "2026-09-01" }], error: null };
      },
    });
    let handler: any;
    load("supabase/functions/find-connections/index.ts", {
      Deno: { env: { get: () => "" }, serve: (h: any) => { handler = h; } }, createClient: () => db,
      checkBalance: async () => ({ allowed: true }), insufficientCreditsResponse: () => new Response("", { status: 402 }), balanceUnavailableResponse: () => new Response("", { status: 503 }),
      getEmbeddingWithCredits: async () => { embeds++; return { embedding: [1], credits: null }; },
      runChat: async (args: any) => { prompts.push(args.messages[0].content); return { content: "fixture insight" }; },
      sourceLanguageRule: () => "", FIND_CONNECTIONS_PROMPT: "fixture", console: quiet,
    });
    return { call: () => handler(post({ note_id: "n" })), prompts, rpcs, embeds: () => embeds };
  }

  it("sends nothing of a note hidden from AI to a model", async () => {
    const f = run({ id: "n", title: "Private title", content: "private body", metadata: {}, embedding: null, ai_visibility: "hidden", user_id: "u" });
    const response = await f.call();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ connections: [], insight: null, skipped: "ai_hidden" });
    expect(f.prompts).toEqual([]);
    expect(f.embeds()).toBe(0);
    expect(f.rpcs).toEqual([]);
  });

  it("leaves hidden people and action items out of the insight prompt but still lists them", async () => {
    const f = run({ id: "n", title: "Visible", content: "body", metadata: { people: ["Alice"] }, embedding: "[1]", ai_visibility: "visible", user_id: "u" }, (q) => {
      if (q.table === "contacts") return { data: [
        { id: "a", name: "Alice", relationship: null, ai_visibility: "hidden" },
        { id: "b", name: "Bob", relationship: null, ai_visibility: "visible" },
      ] };
      if (q.table === "action_items") return { data: [
        { id: "x", content: "Hidden errand", status: "open", source_note_id: "m", ai_visibility: "hidden" },
        { id: "y", content: "Visible errand", status: "open", source_note_id: "m", ai_visibility: "visible" },
      ] };
      return null;
    });
    const body = await (await f.call()).json();
    expect(f.prompts).toHaveLength(1);
    expect(f.prompts[0]).toContain("Bob");
    expect(f.prompts[0]).not.toContain("Alice");
    expect(f.prompts[0]).toContain("Visible errand");
    expect(f.prompts[0]).not.toContain("Hidden errand");
    expect(body.related_contacts).toEqual([{ id: "a", name: "Alice", relationship: null }, { id: "b", name: "Bob", relationship: null }]);
    expect(body.related_actions.map((a: any) => a.id)).toEqual(["x", "y"]);
  });
});

describe("group AI prompts", () => {
  const groupBindings = (db: unknown, prompts: string[]) => ({
    corsHeaders: {}, isUuid: () => true, jsonResponse: (body: unknown, status = 200) => new Response(JSON.stringify(body), { status }),
    getAuthedAdmin: async () => ({ userId: "u", admin: db }), ensureCredits: async () => ({ tokens: 1, credits: 1 }),
    deductFixedCredits: async () => ({}), noteText, taggedPrompt, console: quiet,
    callJson: async (_db: unknown, _u: string, _site: string, messages: Array<{ content: string }>) => {
      prompts.push(messages.map((m) => m.content).join("\n"));
      return { suggestions: [], title: "Follow up" };
    },
  });
  const notes = [
    { id: "v", title: "Visible note", content: "visible text", user_id: "u", is_trashed: false, ai_visibility: "visible" },
    { id: "h", title: "Hidden note", content: "hidden text", user_id: "u", is_trashed: false, ai_visibility: "hidden" },
    { id: "t", title: "Trashed note", content: "trashed text", user_id: "u", is_trashed: true, ai_visibility: "visible" },
  ];

  it("suggest-group-members sends no hidden note and no hidden person to the model", async () => {
    const prompts: string[] = [];
    let imported: any[] = [];
    const { db } = fakeDb((q) => {
      if (q.table === "contact_groups") return { data: { id: "g", user_id: "u", name: "Group", stages: [] } };
      if (q.table === "contact_group_memberships") return { data: [] };
      if (q.table === "contacts") return { data: [
        { id: "c1", name: "Visible Person", user_id: "u", ai_visibility: "visible" },
        { id: "c2", name: "Hidden Person", user_id: "u", ai_visibility: "hidden" },
      ] };
      if (q.table === "notes") return { data: notes };
      return { data: [] };
    });
    let handler: any;
    load("supabase/functions/suggest-group-members/index.ts", {
      serve: (h: any) => { handler = h; }, ...groupBindings(db, prompts),
      importGroupMembersFromNotes: async (_db: unknown, _u: string, _g: unknown, rows: any[]) => { imported = rows; return null; },
    });
    expect((await handler(post({ group_id: "g" }))).status).toBe(200);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain("Visible Person");
    expect(prompts[0]).not.toContain("Hidden Person");
    expect(prompts[0]).toContain("visible text");
    expect(prompts[0]).not.toContain("hidden text");
    expect(prompts[0]).not.toContain("trashed text");
    // The structured (non-AI) import still sees every live note.
    expect(imported.map((n) => n.id)).toEqual(["v", "h"]);
  });

  it("suggest-group-next-step sends no hidden or trashed note to the model", async () => {
    const prompts: string[] = [];
    const { db } = fakeDb((q) => {
      if (q.table === "contact_group_memberships") return { data: { id: "m", contact_id: "c", contacts: { name: "Alice" }, contact_groups: { name: "Group" } } };
      if (q.table === "contact_interactions") return { data: [] };
      if (q.table === "notes") return { data: notes };
      return { data: [] };
    });
    let handler: any;
    load("supabase/functions/suggest-group-next-step/index.ts", { serve: (h: any) => { handler = h; }, ...groupBindings(db, prompts) });
    expect((await handler(post({ membership_id: "m" }))).status).toBe(200);
    expect(prompts[0]).toContain("visible text");
    expect(prompts[0]).not.toContain("hidden text");
    expect(prompts[0]).not.toContain("trashed text");
  });
});
