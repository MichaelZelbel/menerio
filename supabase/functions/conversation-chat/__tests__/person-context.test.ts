import { describe, expect, it } from "vitest";
import {
  buildPersonContext,
  personHiddenFromAi,
  relatedMomentsFor,
  relatedNotesFor,
  type PersonRow,
} from "../person-context";

const anna: PersonRow = {
  id: "p-anna",
  name: "Anna",
  notes: "Private contact note about Anna",
  aliases: ["Annie"],
  tags: ["friend"],
  is_sensitive: false,
  ai_visibility: "visible",
};

describe("conversation-chat person context", () => {
  it("a sensitive or hidden person is a name and nothing more", () => {
    for (const person of [
      { ...anna, is_sensitive: true },
      { ...anna, ai_visibility: "hidden" },
    ]) {
      expect(personHiddenFromAi(person)).toBe(true);
      const ctx = buildPersonContext(
        person,
        [{ claim_id: "c1", label: "Diagnosis", attribute: "diagnosis", value: "secret value" } as never],
        [{ title: "Therapy session", created_at: "2026-09-01" }],
        [{ title: "Hospital", description: "secret moment", happened_at: "2026-09-02" }],
      );
      expect(ctx).toContain("Name: Anna");
      expect(ctx).toContain("hidden this person from AI");
      expect(ctx).not.toContain("Private contact note");
      expect(ctx).not.toContain("secret value");
      expect(ctx).not.toContain("Therapy session");
      expect(ctx).not.toContain("secret moment");
      expect(ctx).not.toContain("friend");
    }
  });

  it("a visible person keeps their context", () => {
    expect(personHiddenFromAi(anna)).toBe(false);
    const ctx = buildPersonContext(anna, [], [{ title: "Lunch", created_at: "2026-09-01" }], []);
    expect(ctx).toContain("Notes: Private contact note about Anna");
    expect(ctx).toContain("Lunch");
  });

  it("drops notes hidden from AI or linked to a hidden or sensitive person", () => {
    // matched_people as process-note stores it: objects, not bare ids.
    const anne = { name: "Anna", contact_id: "p-anna", canonical_name: "Anna" };
    const bob = { name: "Bob", contact_id: "p-bob", canonical_name: "Bob" };
    const notes = [
      { title: "ok", created_at: null, ai_visibility: "visible", metadata: { people: ["anna"], matched_people: [anne, { name: "Me", is_self: true }] } },
      { title: "with sensitive Bob", created_at: null, ai_visibility: "visible", metadata: { people: ["Anna", "Bob"], matched_people: [anne, bob] } },
      { title: "legacy bare id", created_at: null, ai_visibility: "visible", metadata: { people: ["Anna"], matched_people: ["p-bob"] } },
      { title: "hidden", created_at: null, ai_visibility: "hidden", metadata: { people: ["Anna"] } },
      { title: "alias", created_at: null, metadata: { people: ["ANNIE"] } },
      { title: "other", created_at: null, metadata: { people: ["Carl"] } },
    ];
    expect(relatedNotesFor(notes, anna, new Set(["p-bob"])).map((n) => n.title)).toEqual(["ok", "alias"]);
  });

  it("drops moments hidden from AI or belonging to a hidden or sensitive person", () => {
    const moments = [
      { title: "Anna's birthday", description: null, happened_at: "x", person_id: "p-anna", ai_visibility: "visible" },
      { title: "Anna met Bob", description: null, happened_at: "x", person_id: "p-bob", ai_visibility: "visible" },
      { title: "Anna hidden", description: null, happened_at: "x", person_id: null, ai_visibility: "hidden" },
      { title: "Unrelated", description: null, happened_at: "x", person_id: null, ai_visibility: "visible" },
    ];
    expect(relatedMomentsFor(moments, anna, new Set(["p-bob"])).map((m) => m.title)).toEqual(["Anna's birthday"]);
  });

  it("fails closed when the hidden-people set could not be read", () => {
    const notes = [{ title: "ok", created_at: null, metadata: { people: ["Anna"] } }];
    const moments = [{ title: "Anna", description: null, happened_at: "x" }];
    expect(relatedNotesFor(notes, anna, null)).toEqual([]);
    expect(relatedMomentsFor(moments, anna, null)).toEqual([]);
  });
});
