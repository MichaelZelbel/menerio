// @vitest-environment node
import { describe, expect, it } from "vitest";
import { executeReadTool, linksHiddenPerson } from "../read-tools";

/**
 * The chat agents' note search (note-chat, conversation-chat, collection-chat).
 * Marking a person sensitive hides their linked notes from every AI feature;
 * the text and media search tools returned them to the model anyway.
 */
const USER = "00000000-0000-4000-8000-000000000001";
const BOB = "00000000-0000-4000-8000-0000000000bb";

type Answer = { data: unknown; error: unknown };

/** A chainable client that answers each table with a fixed result; `.range()` pages it. */
function fakeDb(tables: Record<string, Answer>) {
  return {
    from(table: string) {
      const answer = tables[table] ?? { data: [], error: null };
      let window: [number, number] | null = null;
      const q: Record<string, unknown> = {};
      for (const m of ["select", "eq", "is", "in", "or", "order", "limit", "neq"]) q[m] = () => q;
      q.range = (from: number, to: number) => { window = [from, to]; return q; };
      q.then = (ok: (v: Answer) => unknown, fail?: (e: unknown) => unknown) => {
        const paged = window && Array.isArray(answer.data)
          ? { ...answer, data: (answer.data as unknown[]).slice(window[0], window[1] + 1) }
          : answer;
        return Promise.resolve(paged).then(ok, fail);
      };
      return q;
    },
  };
}

// matched_people entries are objects in the live data ({ name, contact_id,
// canonical_name }); every one of 3,206 on 2026-09-29, none a plain string.
const NOTES = [
  { id: "n1", title: "About Anna", content: "lunch", tags: [], metadata: { matched_people: [{ name: "Anna", contact_id: "anna", canonical_name: "Anna" }] } },
  { id: "n2", title: "About Bob", content: "therapy", tags: [], metadata: { matched_people: [{ name: "Bob", contact_id: BOB, canonical_name: "Bob" }] } },
  { id: "n3", title: "No people", content: "shopping", tags: [], metadata: null },
];

describe("read tools and people hidden from AI", () => {
  it("linksHiddenPerson matches matched_people entries by contact_id, objects and plain ids alike", () => {
    const hidden = new Set([BOB]);
    expect(linksHiddenPerson({ matched_people: [{ name: "Bob", contact_id: BOB, canonical_name: "Bob" }] }, hidden)).toBe(true);
    expect(linksHiddenPerson({ matched_people: [{ name: "Me", is_self: true }, { name: "Bob", contact_id: BOB }] }, hidden)).toBe(true);
    expect(linksHiddenPerson({ matched_people: [BOB] }, hidden)).toBe(true);
    expect(linksHiddenPerson({ matched_people: [{ name: "X", contact_id: "x" }] }, hidden)).toBe(false);
    expect(linksHiddenPerson(null, hidden)).toBe(false);
    expect(linksHiddenPerson({ matched_people: [{ contact_id: BOB }] }, new Set())).toBe(false);
  });

  it("search_notes_text leaves out a note linked to a sensitive person", async () => {
    const db = fakeDb({ notes: { data: NOTES, error: null }, contacts: { data: [{ id: BOB }], error: null } });
    const out = JSON.parse(await executeReadTool(db, "key", USER, "search_notes_text", { query: "a" }));
    expect(out.results.map((r: { id: string }) => r.id)).toEqual(["n1", "n3"]);
  });

  it("search_notes_text fails closed when the hidden list cannot be read", async () => {
    const db = fakeDb({ notes: { data: NOTES, error: null }, contacts: { data: null, error: { message: "timeout" } } });
    const out = JSON.parse(await executeReadTool(db, "key", USER, "search_notes_text", { query: "a" }));
    expect(out.results).toBeUndefined();
    expect(out.error).toMatch(/hidden from AI/);
  });

  it("search_media_text leaves out a scan in a note linked to a sensitive person", async () => {
    const db = fakeDb({
      media_analysis: {
        data: [
          { id: "m1", note_id: "n1", extracted_text: "a" },
          { id: "m2", note_id: "n2", extracted_text: "b" },
        ],
        error: null,
      },
      notes: { data: NOTES.slice(0, 2), error: null },
      contacts: { data: [{ id: BOB }], error: null },
    });
    const out = JSON.parse(await executeReadTool(db, "key", USER, "search_media_text", { query: "a" }));
    expect(out.results.map((r: { id: string }) => r.id)).toEqual(["m1"]);
  });
});
