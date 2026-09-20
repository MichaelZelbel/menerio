import { beforeEach, describe, expect, it } from "vitest";
import {
  buildSearchSnippet,
  clampSearchLimit,
  combinedNoteSearch,
  parseSourceAppFilter,
  sourceAppMatches,
} from "../note-search";
import type { Row } from "./memory-db";

const USER = "user-a";

let notes: Row[];
let chunks: Row[];
let rpcCalls: Row[];
let rpcError: { message: string } | null;
let textError: { message: string } | null;

/**
 * Just enough of PostgREST to run the search for real: the filters are
 * evaluated, not ignored, so a missing user or trash condition shows up as a
 * foreign or trashed note in the results.
 */
function fakeDb() {
  return {
    async rpc(name: string, args: Row) {
      rpcCalls.push({ name, args });
      if (rpcError) return { data: null, error: rpcError };
      const live = new Set(notes.filter((n) => n.user_id === args.p_user_id && !n.is_trashed).map((n) => n.id));
      const data = chunks
        .filter((c) => live.has(c.note_id) && c.similarity > args.match_threshold)
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, args.match_count);
      return { data, error: null };
    },
    from(table: string) {
      if (table !== "notes") throw new Error(`unexpected table ${table}`);
      let rows = [...notes];
      let isText = false;
      const q: Row = {
        select: () => q,
        eq: (k: string, v: unknown) => { rows = rows.filter((r) => r[k] === v); return q; },
        in: (k: string, vs: unknown[]) => { rows = rows.filter((r) => vs.includes(r[k])); return q; },
        ilike: (k: string, v: string) => { rows = rows.filter((r) => String(r[k] ?? "").toLowerCase() === v.toLowerCase()); return q; },
        or: (expr: string) => {
          if (expr.startsWith("source_app.is.null")) {
            rows = rows.filter((r) => r.source_app == null || String(r.source_app).toLowerCase() !== "hub");
          } else {
            isText = true;
            const m = /ilike\."%(.*?)%"/.exec(expr);
            const needle = (m?.[1] ?? "").toLowerCase();
            rows = rows.filter((r) => `${r.title}\n${r.content}`.toLowerCase().includes(needle));
          }
          return q;
        },
        order: () => { rows.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at))); return q; },
        limit: (n: number) => { rows = rows.slice(0, n); return q; },
        then: (ok: (v: unknown) => unknown) =>
          Promise.resolve(ok(isText && textError ? { data: null, error: textError } : { data: rows, error: null })),
      };
      return q;
    },
  };
}

const note = (id: string, over: Row = {}): Row => ({
  id, user_id: USER, title: id, content: "", tags: [], entity_type: null, is_favorite: false, is_pinned: false,
  is_trashed: false, folder_path: "", source_app: "web", source_id: null,
  created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", ...over,
});
const chunk = (note_id: string, similarity: number, content = "chunk text"): Row => ({ note_id, similarity, content });
const embed = async () => [0.1, 0.2];

beforeEach(() => {
  notes = []; chunks = []; rpcCalls = []; rpcError = null; textError = null;
});

describe("combinedNoteSearch", () => {
  it("finds a note by meaning that contains none of the query's words", async () => {
    notes = [note("n1", { title: "Dentist", content: "Root canal booked for March." })];
    chunks = [chunk("n1", 0.61, "Root canal booked for March.")];
    const { results, mode } = await combinedNoteSearch(fakeDb(), { userId: USER, query: "tooth appointment", embed });
    expect(mode).toBe("semantic+text");
    expect(results.map((r) => r.id)).toEqual(["n1"]);
    expect(results[0].similarity).toBe(0.61);
    expect(results[0].snippet).toContain("Root canal");
  });

  it("merges the two arms per note and keeps the best chunk's similarity", async () => {
    notes = [note("n1", { content: "the quarterly budget is tight" })];
    chunks = [chunk("n1", 0.4), chunk("n1", 0.7), chunk("n1", 0.5)];
    const { results } = await combinedNoteSearch(fakeDb(), { userId: USER, query: "budget", embed });
    expect(results).toHaveLength(1);
    expect(results[0].similarity).toBe(0.7);
  });

  it("returns every field the contract names, and the ones older callers read", async () => {
    notes = [note("n1", { title: "Budget", content: "budget", folder_path: "Money", source_app: "hub", source_id: "money/budget.md", tags: ["x"] })];
    const { results } = await combinedNoteSearch(fakeDb(), { userId: USER, query: "budget", embed });
    expect(Object.keys(results[0]).sort()).toEqual([
      "content", "created_at", "entity_type", "folder_path", "id", "is_favorite", "is_pinned",
      "similarity", "snippet", "source_app", "source_id", "tags", "title", "updated_at",
    ]);
    expect(results[0]).toMatchObject({ folder_path: "Money", source_app: "hub", source_id: "money/budget.md", similarity: null });
  });

  it("ranks a native note above a hub file that is more similar", async () => {
    notes = [note("hubfile", { source_app: "hub" }), note("mine", { source_app: "web" })];
    chunks = [chunk("hubfile", 0.9), chunk("mine", 0.5)];
    const { results } = await combinedNoteSearch(fakeDb(), { userId: USER, query: "unrelated words", embed });
    expect(results.map((r) => r.id)).toEqual(["mine", "hubfile"]);
    // The figure reported is the measurement, not the discounted sort key.
    expect(results[1].similarity).toBe(0.9);
  });

  it("filters to the mirror with source_app=hub, whatever the case", async () => {
    notes = [note("hubfile", { source_app: "hub", content: "budget" }), note("mine", { content: "budget" })];
    chunks = [chunk("hubfile", 0.5), chunk("mine", 0.9)];
    const { results } = await combinedNoteSearch(fakeDb(), { userId: USER, query: "budget", sourceApp: " HUB ", embed });
    expect(results.map((r) => r.id)).toEqual(["hubfile"]);
  });

  it("filters the mirror out with source_app=native, in both arms", async () => {
    notes = [note("hubfile", { source_app: "hub", content: "budget" }), note("mine", { content: "budget" }), note("old", { source_app: null })];
    chunks = [chunk("hubfile", 0.9), chunk("old", 0.4)];
    const { results } = await combinedNoteSearch(fakeDb(), { userId: USER, query: "budget", sourceApp: "native", embed });
    expect(results.map((r) => r.id).sort()).toEqual(["mine", "old"]);
  });

  it("asks for more chunks when a source filter will throw most of them away", async () => {
    await combinedNoteSearch(fakeDb(), { userId: USER, query: "q", embed });
    await combinedNoteSearch(fakeDb(), { userId: USER, query: "q", sourceApp: "native", embed });
    expect(rpcCalls[1].args.match_count).toBeGreaterThan(rpcCalls[0].args.match_count);
    expect(rpcCalls[1].args.match_count).toBeLessThanOrEqual(200);
  });

  it("degrades to text only when credits are exhausted, and says so", async () => {
    notes = [note("n1", { content: "budget" })];
    const { results, mode } = await combinedNoteSearch(fakeDb(), {
      userId: USER, query: "budget",
      embed: async () => { throw new Error("INSUFFICIENT_CREDITS"); },
    });
    expect(mode).toBe("text_only");
    expect(results.map((r) => r.id)).toEqual(["n1"]);
    expect(rpcCalls).toEqual([]);
  });

  it("degrades to text only when the embedding call or the RPC fails", async () => {
    notes = [note("n1", { content: "budget" })];
    const viaProvider = await combinedNoteSearch(fakeDb(), { userId: USER, query: "budget", embed: async () => { throw new Error("502 Bad Gateway"); } });
    expect(viaProvider.mode).toBe("text_only");
    rpcError = { message: "function match_note_chunks does not exist" };
    const viaRpc = await combinedNoteSearch(fakeDb(), { userId: USER, query: "budget", embed });
    expect(viaRpc.mode).toBe("text_only");
    expect(viaRpc.results.map((r) => r.id)).toEqual(["n1"]);
  });

  it("still answers from the vector arm when only the text query fails", async () => {
    notes = [note("n1")];
    chunks = [chunk("n1", 0.6)];
    textError = { message: "statement timeout" };
    const { results, mode } = await combinedNoteSearch(fakeDb(), { userId: USER, query: "anything", embed });
    expect(mode).toBe("semantic+text");
    expect(results.map((r) => r.id)).toEqual(["n1"]);
  });

  it("throws only when both arms are down, because 'no results' would be untrue", async () => {
    textError = { message: "statement timeout" };
    await expect(combinedNoteSearch(fakeDb(), { userId: USER, query: "q", embed: async () => { throw new Error("x"); } }))
      .rejects.toThrow("statement timeout");
  });

  it("never returns another user's note or a trashed one, even if a chunk points at it", async () => {
    notes = [
      note("theirs", { user_id: "user-b", content: "budget" }),
      note("binned", { is_trashed: true, content: "budget" }),
      note("mine", { content: "budget" }),
    ];
    chunks = [chunk("theirs", 0.99), chunk("binned", 0.98), chunk("mine", 0.3)];
    // A misbehaving RPC that ignores its own user filter must not leak through hydration.
    const db = fakeDb();
    db.rpc = async () => ({ data: chunks, error: null });
    const { results } = await combinedNoteSearch(db, { userId: USER, query: "budget", embed });
    expect(results.map((r) => r.id)).toEqual(["mine"]);
  });

  it("honours the limit, defaulting to 10 and never passing 50", async () => {
    notes = Array.from({ length: 60 }, (_, i) => note(`n${i}`, { content: "budget" }));
    expect((await combinedNoteSearch(fakeDb(), { userId: USER, query: "budget", embed })).results).toHaveLength(10);
    expect((await combinedNoteSearch(fakeDb(), { userId: USER, query: "budget", limit: 500, embed })).results).toHaveLength(50);
    expect((await combinedNoteSearch(fakeDb(), { userId: USER, query: "budget", limit: 3, embed })).results).toHaveLength(3);
  });
});

describe("clampSearchLimit", () => {
  it("falls back to the default for anything that is not a number", () => {
    expect(clampSearchLimit("all")).toBe(10);
    expect(clampSearchLimit(null)).toBe(10);
    expect(clampSearchLimit(undefined)).toBe(10);
  });
  it("clamps to 1..50", () => {
    expect(clampSearchLimit("0")).toBe(1);
    expect(clampSearchLimit("51")).toBe(50);
    expect(clampSearchLimit(25)).toBe(25);
  });
});

describe("parseSourceAppFilter / sourceAppMatches", () => {
  it("treats a missing or 'all' value as no filter", () => {
    expect(parseSourceAppFilter(null)).toEqual({ kind: "all" });
    expect(parseSourceAppFilter(" ALL ")).toEqual({ kind: "all" });
  });
  it("matches any other sender by name", () => {
    const f = parseSourceAppFilter("Telegram");
    expect(sourceAppMatches("telegram", f)).toBe(true);
    expect(sourceAppMatches("hub", f)).toBe(false);
    expect(sourceAppMatches(null, f)).toBe(false);
  });
});

describe("buildSearchSnippet", () => {
  const long = `${"a ".repeat(400)}the NEEDLE sits here ${"b ".repeat(400)}`;

  it("centres about 300 characters on the literal query in the body", () => {
    const s = buildSearchSnippet({ content: long }, "needle");
    expect(s).toContain("NEEDLE");
    expect(s.startsWith("…")).toBe(true);
    expect(s.endsWith("…")).toBe(true);
    expect(s.length).toBeGreaterThan(200);
    expect(s.length).toBeLessThanOrEqual(310);
  });

  it("falls back to the matching chunk when the body never says the query", () => {
    const s = buildSearchSnippet({ content: "Totally different opening.", chunk: "Root canal booked for March." }, "tooth appointment");
    expect(s).toBe("Root canal booked for March.");
  });

  it("finds a single term of a sentence query", () => {
    const s = buildSearchSnippet({ content: long }, "where is the needle kept");
    expect(s).toContain("NEEDLE");
  });

  it("collapses whitespace and survives an empty note", () => {
    expect(buildSearchSnippet({ content: "one\n\n\ttwo" }, "zzz")).toBe("one two");
    expect(buildSearchSnippet({ content: null }, "zzz")).toBe("");
  });
});
