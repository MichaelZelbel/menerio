import { describe, expect, it } from "vitest";
import { blockedModerationEvent, loadSharedNoteForReview, reviewQueueItem } from "../moderation-source.ts";

type Row = Record<string, unknown>;
function fakeDb(tables: Record<string, Row[]>) {
  return {
    from(table: string) {
      const filters: Array<[string, unknown]> = [];
      const q = {
        select: () => q,
        eq: (col: string, val: unknown) => { filters.push([col, val]); return q; },
        maybeSingle: async () => ({
          data: (tables[table] ?? []).find((r) => filters.every(([c, v]) => r[c] === v)) ?? null,
          error: null,
        }),
      };
      return q;
    },
  };
}

const db = fakeDb({
  shared_notes: [
    { note_id: "n1", user_id: "u1", is_active: true },
    { note_id: "n2", user_id: "u1", is_active: false },
  ],
  notes: [
    { id: "n1", user_id: "u1", title: "Trip", content: "<p>Hello <b>world</b></p>" },
    { id: "n2", user_id: "u1", title: "Old", content: "gone" },
    { id: "n3", user_id: "u2", title: "Other", content: "x" },
  ],
});

describe("loadSharedNoteForReview", () => {
  it("returns the plain text of a note that is still publicly shared by its owner", async () => {
    expect(await loadSharedNoteForReview(db, "n1", "u1")).toEqual({ title: "Trip", text: "Trip Hello world" });
  });
  it("returns null once the share was turned off", async () => {
    expect(await loadSharedNoteForReview(db, "n2", "u1")).toBeNull();
  });
  it("returns null for a note that was never shared or belongs to someone else", async () => {
    expect(await loadSharedNoteForReview(db, "n3", "u1")).toBeNull();
  });
  it("returns null without a note id", async () => {
    expect(await loadSharedNoteForReview(db, null, "u1")).toBeNull();
  });
});

describe("record builders never carry text", () => {
  it("a blocked event keeps matched words and category, and no content field", () => {
    const e = blockedModerationEvent({ userId: "u1", action: "share_note", itemType: "note", itemId: "n1", matched: ["badword", "[PII:email]"], category: "abuse", tier: "stopword" });
    expect(e).toEqual({ user_id: "u1", action: "share_note", item_type: "note", item_id: "n1", matched_words: ["badword", "[PII:email]"], category: "abuse", result: "blocked", tier: "stopword" });
    expect(Object.keys(e)).not.toContain("flagged_content");
  });
  it("a queue item is a reference only", () => {
    expect(reviewQueueItem({ userId: "u1", itemType: "note", itemId: "n1" })).toEqual({ user_id: "u1", item_type: "note", item_id: "n1", status: "pending" });
  });
});
