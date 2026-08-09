import { describe, it, expect } from "vitest";
import { relationshipPairKey, type EntityRef } from "@/lib/relationship-canonical";

const U = "user-1";
const self: EntityRef = { type: "self", id: null };
const p = (id: string): EntityRef => ({ type: "contact", id });

const key = (a: EntityRef, b: EntityRef, label: string) => relationshipPairKey(U, a, b, label);

describe("relationship pair keys collapse mirrored bonds", () => {
  it("collapses parent/child stored in both directions", () => {
    expect(key(p("brigitte"), self, "mother")).toBe(key(self, p("brigitte"), "son"));
  });

  it("collapses step-family stored in both directions", () => {
    expect(key(p("juergen"), self, "stepfather")).toBe(key(self, p("juergen"), "stepson"));
  });

  it("collapses gendered spouse labels onto the neutral bond", () => {
    expect(key(self, p("x"), "wife")).toBe(key(p("x"), self, "husband"));
    expect(key(self, p("x"), "spouse")).toBe(key(self, p("x"), "wife"));
  });

  it("keeps genuinely different people apart", () => {
    expect(key(p("a"), self, "partner")).not.toBe(key(p("b"), self, "partner"));
  });

  it("keeps genuinely different bonds with the same person apart", () => {
    expect(key(p("a"), self, "mother")).not.toBe(key(p("a"), self, "manager"));
  });

  it("reduces a real nine-row account to one row per bond", () => {
    const rows: Array<[EntityRef, EntityRef, string]> = [
      [self, p("shoko"), "friend"],
      [p("gunther"), self, "manager"],
      [p("brigitte"), self, "mother"],
      [self, p("brigitte"), "son"],
      [p("xihui"), self, "partner"],
      [p("yumei"), self, "partner"],
      [self, p("spouse-person"), "spouse"],
      [p("juergen"), self, "stepfather"],
      [self, p("juergen"), "stepson"],
    ];
    const keys = new Set(rows.map(([a, b, l]) => key(a, b, l)));
    expect(keys.size).toBe(7);
  });
});
