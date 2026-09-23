import { describe, expect, it } from "vitest";
import { createNoteEditSession, executeNoteEditTool, replacedChars } from "../note-edit-tools";

function noteDb(initial: string) {
  const state = { content: initial, updated_at: "2026-09-23T10:00:00.000Z", writes: 0 };
  const db = {
    from: () => {
      const q: any = {
        select: () => q,
        eq: () => q,
        update: (row: { content: string }) => { state.content = row.content; state.writes++; return q; },
        maybeSingle: async () => ({ data: { content: state.content, updated_at: state.updated_at }, error: null }),
        single: async () => ({ data: { updated_at: state.updated_at }, error: null }),
      };
      return q;
    },
  };
  return { db, state };
}

describe("replace_in_note deletion guard", () => {
  it("counts only the characters a replacement discards", () => {
    expect(replacedChars("the quick brwn fox", "the quick brown fox")).toBe(0);
    expect(replacedChars("abc", "abcdef")).toBe(0);
    expect(replacedChars("a".repeat(100), "b".repeat(100))).toBe(100);
  });

  it("refuses a same-length rewrite of the user's text without confirm_delete", async () => {
    const original = "Budget: " + "x".repeat(500);
    const { db, state } = noteDb(original);
    const session = createNoteEditSession("note-1", state.updated_at);
    const out = JSON.parse(await executeNoteEditTool(db, "u", session, "replace_in_note", {
      find: original,
      replace: "Budget: " + "y".repeat(500),
    }));
    expect(out.error).toBe("deletion_blocked");
    expect(state.writes).toBe(0);
  });

  it("allows a small correction inside a long snippet", async () => {
    const original = "A long paragraph with one tpyo that the user wants fixed, and more text after it.";
    const { db, state } = noteDb(original);
    const session = createNoteEditSession("note-1", state.updated_at);
    const out = JSON.parse(await executeNoteEditTool(db, "u", session, "replace_in_note", {
      find: original,
      replace: original.replace("tpyo", "typo"),
    }));
    expect(out.success).toBe(true);
    expect(state.content).toContain("typo");
  });
});
