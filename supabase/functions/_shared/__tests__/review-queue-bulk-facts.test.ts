import { readFileSync } from "node:fs";
import ts from "typescript";
import { z } from "zod";
import { describe, expect, it, vi } from "vitest";
import { suppressionKey } from "../fact-store";

// The real review-queue-bulk Edge function body, run against a small
// in-memory table store. Revert of an applied profile fact deletes the claim
// and writes the "never suggest again" row itself; items the fact-store
// switch marked not revertible are left alone and reported.
const owner = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";

type Row = Record<string, any>;
function memoryDb(tables: Record<string, Row[]>) {
  const log: Array<{ table: string; op: string; filters: unknown[][] }> = [];
  let nextId = 1;
  const from = (table: string) => {
    tables[table] ??= [];
    const filters: unknown[][] = [];
    let op = "select";
    let patch: any = null;
    let single = false;
    let returning = false;
    let range: [number, number] | null = null;
    const matches = (row: Row) => filters.every(([m, col, v]: any[]) =>
      m === "eq" ? row[col] === v : m === "in" ? v.includes(row[col]) : m === "is" ? (row[col] ?? null) === v : true);
    const run = () => {
      log.push({ table, op, filters: [...filters] });
      const rows = tables[table];
      let data: any;
      if (op === "insert" || op === "upsert") {
        const items = (Array.isArray(patch) ? patch : [patch]).map((x: Row) => ({ id: x.id ?? `${table}-${nextId++}`, ...x }));
        rows.push(...items);
        data = items;
      } else if (op === "update") {
        data = rows.filter(matches);
        for (const r of data) Object.assign(r, patch);
      } else if (op === "delete") {
        data = rows.filter(matches);
        tables[table] = rows.filter((r) => !matches(r));
      } else {
        data = rows.filter(matches);
        if (range) data = data.slice(range[0], range[1] + 1);
      }
      if (op !== "select" && !returning && !single) data = null;
      if (single) data = Array.isArray(data) ? data[0] ?? null : data;
      return { data, error: null };
    };
    const q: any = new Proxy({}, { get: (_t, method: string) => {
      if (method === "then") return (resolve: any, reject: any) => Promise.resolve(run()).then(resolve, reject);
      return (...args: any[]) => {
        if (["insert", "update", "upsert", "delete"].includes(method)) { op = method; patch = args[0]; }
        else if (method === "select" && op !== "select") returning = true;
        else if (method === "maybeSingle" || method === "single") single = true;
        else if (method === "range") range = [args[0], args[1]];
        else if (["eq", "in", "is"].includes(method)) filters.push([method, ...args]);
        return q;
      };
    } });
    return q;
  };
  return { db: { from, rpc: async () => ({ data: false, error: null }) }, tables, log };
}

function load(tables: Record<string, Row[]>) {
  const mem = memoryDb(tables);
  const background: Promise<unknown>[] = [];
  const fetch = vi.fn(async () => new Response("{}", { status: 410 }));
  const writeFact = vi.fn();
  let handler!: (req: Request) => Promise<Response>;
  const bindings: Record<string, unknown> = {
    z, suppressionKey, writeFact, fetch,
    relationshipWriteDecision: () => ({ ok: true }), adjudicateRelationship: async () => ({ outcome: "keep" }), findOrCreateContact: async () => ({ id: "c", created: false }),
    serve: (fn: typeof handler) => { handler = fn; },
    createClient: (_url: string, key: string) => key === "fixture-anon"
      ? { auth: { getUser: async () => ({ data: { user: { id: owner } }, error: null }) } } : mem.db,
    Deno: { env: { get: (k: string) => ({ SUPABASE_URL: "https://fixture.invalid", SUPABASE_SERVICE_ROLE_KEY: "fixture-service", SUPABASE_ANON_KEY: "fixture-anon" } as Record<string, string>)[k] } },
    EdgeRuntime: { waitUntil: (p: Promise<unknown>) => background.push(p) },
    console: { log: () => {}, warn: () => {}, error: () => {} },
  };
  const source = readFileSync("supabase/functions/review-queue-bulk/index.ts", "utf8").replace(/^import[\s\S]*?from\s+["'][^"']+["'];\s*/gm, "");
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  new Function(...Object.keys(bindings), code)(...Object.values(bindings));
  return {
    ...mem, fetch, writeFact,
    request: async (body: unknown) => {
      const res = await handler(new Request("https://fixture.invalid/review-queue-bulk", { method: "POST", headers: { Authorization: "Bearer user" }, body: JSON.stringify(body) }));
      await Promise.all(background.splice(0));
      return res;
    },
  };
}

const item = (over: Row = {}): Row => ({
  id: "33333333-3333-4333-8333-333333333333", user_id: owner, suggestion_type: "add_profile_entry", status: "auto_applied_unreviewed",
  target_entity_type: "claim", target_entity_id: "claim-1", applied_at: "2026-09-28T00:00:00Z", source_note_id: "note-1",
  suppression_key: "add_profile_entry:contact:c1:current city:lisbon", extracted_value: "Current city: Lisbon", title: "t",
  payload: { contact_id: "c1", label: "Current city", value: "Lisbon" }, created_at: "2026-09-28", ...over,
});
const claim = (over: Row = {}): Row => ({ id: "claim-1", user_id: owner, subject_type: "contact", subject_id: "c1", attribute: "current-city", value: "Lisbon ", rank: "normal", ...over });

describe("review-queue-bulk revert of profile facts", () => {
  it.each(["rollback", "never_again"])("%s deletes the claim and writes the claim suppression", async (action) => {
    const f = load({ review_queue: [item()], claims: [claim(), claim({ id: "claim-2" })], ai_suggestion_suppressions: [] });
    expect((await f.request({ action, scope: { ids: [item().id] } })).status).toBe(202);
    expect(f.tables.claims.map((c) => c.id)).toEqual(["claim-2"]);
    const sup = f.tables.ai_suggestion_suppressions.find((s) => s.suggestion_type === "claim");
    expect(sup).toMatchObject({
      user_id: owner, target_entity_type: "claim", target_entity_id: "claim-1", normalized_value: "lisbon",
      suppression_key: suppressionKey({ type: "contact", id: "c1" }, "current-city", "Lisbon"),
    });
    expect(f.tables.review_queue[0].status).toBe(action === "rollback" ? "removed" : "blocked");
    expect(f.tables.review_queue_bulk_jobs[0]).toMatchObject({ status: "done", last_error: null });
    // Every claim read and delete is scoped to the user (service role bypasses RLS).
    for (const q of f.log.filter((l) => l.table === "claims")) expect(q.filters).toContainEqual(["eq", "user_id", owner]);
    expect(f.fetch).not.toHaveBeenCalled();
  });

  it("removes every claim of a split bag", async () => {
    const f = load({ review_queue: [item({ payload: { contact_id: "c1", label: "Language", value: "German, French", claim_ids: ["claim-1", "claim-2"] } })],
      claims: [claim({ attribute: "language", value: "German" }), claim({ id: "claim-2", attribute: "language", value: "French" })], ai_suggestion_suppressions: [] });
    await f.request({ action: "rollback", scope: { ids: [item().id] } });
    expect(f.tables.claims).toEqual([]);
    expect(f.tables.ai_suggestion_suppressions.filter((s) => s.suggestion_type === "claim")).toHaveLength(2);
  });

  it.each([
    ["the switch marked it not revertible", item({ payload: { contact_id: "c1", value: "Lisbon", fact_store_switch: { entry_id: "e1", revertible: false } } })],
    ["its entry was missing at the switch", item({ target_entity_type: "profile_entry", payload: { value: "Lisbon", fact_store_switch: { entry_missing: true, revertible: false } } })],
    ["it still points at the retired profile table", item({ target_entity_type: "profile_entry" })],
  ])("refuses to revert when %s, and reports it", async (_why, row) => {
    const f = load({ review_queue: [row], claims: [claim()], ai_suggestion_suppressions: [] });
    await f.request({ action: "rollback", scope: { ids: [row.id] } });
    expect(f.tables.claims).toHaveLength(1);
    expect(f.tables.ai_suggestion_suppressions).toEqual([]);
    expect(f.tables.review_queue[0].status).toBe("auto_applied_unreviewed");
    expect(f.tables.review_queue_bulk_jobs[0]).toMatchObject({ status: "done", last_error: "1 not revertible" });
  });

  it("never deletes a claim a human has made their own", async () => {
    const f = load({ review_queue: [item()], claims: [claim({ rank: "preferred" })], ai_suggestion_suppressions: [] });
    await f.request({ action: "rollback", scope: { ids: [item().id] } });
    expect(f.tables.claims).toHaveLength(1);
    expect(f.tables.review_queue_bulk_jobs[0].last_error).toBe("1 not revertible");
  });

  it("cannot touch another account's claim", async () => {
    const f = load({ review_queue: [item()], claims: [claim({ user_id: other })], ai_suggestion_suppressions: [] });
    await f.request({ action: "rollback", scope: { ids: [item().id] } });
    expect(f.tables.claims).toHaveLength(1);
    expect(f.tables.ai_suggestion_suppressions).toEqual([]);
  });

  it("supersedes retired normalizer items instead of calling the normalizer", async () => {
    const row = item({ suggestion_type: "normalize_profile_entry", status: "pending_review", target_entity_type: null, target_entity_id: null, applied_at: null });
    for (const action of ["keep", "rollback"]) {
      const f = load({ review_queue: [{ ...row }], ai_suggestion_suppressions: [] });
      await f.request({ action, scope: { ids: [row.id] } });
      expect(f.tables.review_queue[0].status).toBe("superseded");
      expect(f.fetch).not.toHaveBeenCalled();
      expect(f.tables.review_queue_bulk_jobs[0].status).toBe("done");
    }
  });
});

describe("review-queue-bulk keep of a new profile field", () => {
  it("writes the fact through writeFact as review_queue and points the item at the claim", async () => {
    const row = item({ suggestion_type: "unknown_profile_field", status: "pending_review", target_entity_type: "claim", target_entity_id: null, applied_at: null,
      payload: { contact_id: "c1", category_slug: "hobbies", label: "Chess rating", canonical_label: "Chess rating", value: "1850", evidence_quote: "My chess rating is 1850" } });
    const f = load({ review_queue: [row], profile_fields: [] });
    f.writeFact.mockResolvedValue({ ok: true, facts: [{ attribute: "chess-rating", outcome: "inserted", claimId: "claim-9" }] });
    await f.request({ action: "keep", scope: { ids: [row.id] } });
    expect(f.writeFact).toHaveBeenCalledWith(expect.anything(), owner, expect.objectContaining({
      subject: { type: "contact", id: "c1" }, label: "Chess rating", value: "1850", categorySlug: "hobbies",
      origin: "review_queue", evidenceQuote: "My chess rating is 1850", sourceType: "note", sourceId: "note-1",
    }), { isHuman: false });
    expect(f.tables.review_queue[0]).toMatchObject({ status: "kept", target_entity_type: "claim", target_entity_id: "claim-9" });
  });

  it("archives a value the user called wrong before", async () => {
    const row = item({ suggestion_type: "unknown_profile_field", status: "pending_review", target_entity_id: null, applied_at: null,
      payload: { contact_id: null, category_slug: "hobbies", label: "Chess rating", value: "1850" } });
    const f = load({ review_queue: [row], profile_fields: [] });
    f.writeFact.mockResolvedValue({ ok: true, facts: [{ attribute: "chess-rating", outcome: "suppressed" }] });
    await f.request({ action: "keep", scope: { ids: [row.id] } });
    expect((f.writeFact.mock.calls[0] as any[])[2].subject).toEqual({ type: "self", id: null });
    expect(f.tables.review_queue[0].status).toBe("removed");
  });
});
