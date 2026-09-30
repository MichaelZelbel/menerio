// @vitest-environment node
import { describe, expect, it } from "vitest";
import * as graphMatching from "../graph-matching.ts";
import * as pagedSelect from "../paged-select.ts";
import * as mcSource from "../mc-source.ts";
import { fakeDb, loadEndpoint, postJson, type QueryLog } from "./edge-harness";

/**
 * get-graph-data, full-graph mode, run as deployed against a synthetic database.
 *
 * The Note Graph shows the newest 200 notes. On 2026-09-23 a mission control
 * copied 407 of its skill files in within a few days, and the newest 200 became
 * 171 skill files: the user's own notes were still there, just pushed out of the
 * window. Mirrored mission control files are left out of the graph unless asked
 * for, and the leaving-out happens in the query, before the limit, so the 200
 * slots go to the user's notes.
 */

type Note = Record<string, unknown>;

function note(id: string, sourceApp: string | null, minutesAgo: number): Note {
  return {
    id,
    user_id: "user-a",
    title: id,
    metadata: {},
    tags: [],
    entity_type: null,
    is_trashed: false,
    ai_visibility: "visible",
    source_app: sourceApp,
    created_at: new Date(Date.UTC(2026, 9, 1) - minutesAgo * 60_000).toISOString(),
  };
}

/** The PostgREST `or` clauses this function may send, read the way the database reads them. */
function orMatches(expr: string, row: Note): boolean {
  return expr.split(",").some((clause) => {
    const [col, ...rest] = clause.split(".");
    const op = rest.join(".");
    if (op === "is.null") return row[col] === null || row[col] === undefined;
    if (op.startsWith("not.ilike.")) {
      const v = row[col];
      if (v === null || v === undefined) return false; // NULL NOT ILIKE x is NULL, not true
      return String(v).toLowerCase() !== op.slice("not.ilike.".length).toLowerCase();
    }
    throw new Error(`unexpected or() clause ${clause}`);
  });
}

function run(notes: Note[], body: Record<string, unknown>) {
  const db = fakeDb((q: QueryLog) => {
    if (q.table !== "notes") return { data: [] };
    let rows = [...notes];
    for (const [method, ...args] of q.ops) {
      if (method === "eq") rows = rows.filter((r) => r[args[0] as string] === args[1]);
      if (method === "or") rows = rows.filter((r) => orMatches(args[0] as string, r));
    }
    rows.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    const limit = q.ops.find((op) => op[0] === "limit");
    return { data: limit ? rows.slice(0, limit[1] as number) : rows };
  });
  const handler = loadEndpoint(
    "supabase/functions/get-graph-data/index.ts",
    {
      "https://esm.sh/@supabase/supabase-js@2": { createClient: () => db.client },
      "../_shared/graph-matching.ts": graphMatching,
      "../_shared/paged-select.ts": pagedSelect,
      "../_shared/mc-source.ts": mcSource,
    },
    { SUPABASE_URL: "https://synthetic.invalid", SUPABASE_SERVICE_ROLE_KEY: "service-key" },
  );
  return handler(postJson("https://synthetic.invalid/functions/v1/get-graph-data", body));
}

// 250 mirrored skill files, all newer than the user's own seven notes.
const mirrors = Array.from({ length: 250 }, (_, i) => note(`skills/file-${i}.md`, "godspeed", i));
const own = [
  ...Array.from({ length: 5 }, (_, i) => note(`own-${i}`, null, 1000 + i)),
  note("from-obsidian", "obsidian", 1010),
  note("from-web", "web_clip", 1011),
];

describe("get-graph-data leaves mirrored mission control files out of the full graph", () => {
  it("by default, so newer mirrors cannot push the user's own notes out of the 200", async () => {
    const res = await run([...mirrors, ...own], { limit: 200 });
    expect(res.status).toBe(200);
    const ids = ((await res.json()).nodes as { id: string }[]).map((n) => n.id).sort();
    expect(ids).toEqual(own.map((n) => n.id as string).sort());
  });

  it("including a mirror whose source_app carries stray case or spaces", async () => {
    const stray = note("skills/stray.md", " GodSpeed ", 0);
    const res = await run([stray, ...own], { limit: 200 });
    const ids = ((await res.json()).nodes as { id: string }[]).map((n) => n.id);
    expect(ids).not.toContain("skills/stray.md");
    expect(ids).toHaveLength(own.length);
  });

  it("and shows them when asked with include_godspeed", async () => {
    const res = await run([...mirrors, ...own], { limit: 200, include_godspeed: true });
    const ids = ((await res.json()).nodes as { id: string }[]).map((n) => n.id);
    expect(ids).toHaveLength(200);
    expect(ids).toContain("skills/file-0.md");
  });
});
