import { describe, it, expect } from "vitest";
import { groupClaims, isCurrent, isHumanWritten, type ClaimRow } from "../world-claims";

function claim(over: Partial<ClaimRow>): ClaimRow {
  return {
    id: Math.random().toString(36).slice(2),
    subject_kind: "self",
    subject_id: null,
    category: "contact",
    attribute: "email",
    value: "a@example.com",
    origin: "ai_note",
    rank: "normal",
    updated_at: "2026-08-01T00:00:00Z",
    ...over,
  };
}

describe("isHumanWritten", () => {
  it("counts a hand-typed entry and anything marked preferred", () => {
    expect(isHumanWritten({ origin: "user_manual", rank: "normal" })).toBe(true);
    expect(isHumanWritten({ origin: "ai_note", rank: "preferred" })).toBe(true);
  });

  it("does not count a plain machine entry", () => {
    expect(isHumanWritten({ origin: "ai_note", rank: "normal" })).toBe(false);
  });
});

describe("isCurrent", () => {
  const today = new Date("2026-08-16T00:00:00Z");

  it("treats a claim with no end date as still true", () => {
    expect(isCurrent({ valid_to: null }, today)).toBe(true);
  });

  it("treats a claim that ended as no longer true", () => {
    expect(isCurrent({ valid_to: "2026-01-31" }, today)).toBe(false);
  });
});

describe("groupClaims", () => {
  it("puts the human's value on top even when a machine wrote later", () => {
    const groups = groupClaims([
      claim({ value: "guessed@example.com", origin: "ai_note", updated_at: "2026-08-15T00:00:00Z" }),
      claim({ value: "michael@zelbel.de", origin: "user_manual", rank: "preferred", updated_at: "2026-01-01T00:00:00Z" }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].top.value).toBe("michael@zelbel.de");
  });

  it("keeps the machine's disagreement instead of dropping it", () => {
    const groups = groupClaims([
      claim({ value: "michael@zelbel.de", origin: "user_manual", rank: "preferred" }),
      claim({ value: "guessed@example.com", origin: "ai_note" }),
    ]);
    expect(groups[0].others.map((o) => o.value)).toEqual(["guessed@example.com"]);
    expect(groups[0].disagreed).toBe(true);
  });

  it("does not call it a disagreement when the values match", () => {
    // Two sources agreeing is the normal case and must not raise a flag.
    const groups = groupClaims([
      claim({ value: "michael@zelbel.de", origin: "user_manual", rank: "preferred" }),
      claim({ value: " Michael@Zelbel.de ", origin: "ai_note" }),
    ]);
    expect(groups[0].disagreed).toBe(false);
  });

  it("keeps several true values of one attribute together, not as rivals", () => {
    // Both addresses are current. The group exists so a machine filling a form
    // knows which to pick, not so one of them can be called wrong.
    const groups = groupClaims([
      claim({ value: "michael@zelbel.de", origin: "user_manual", rank: "preferred" }),
      claim({ value: "michael@ownward.studio", origin: "user_manual", rank: "preferred" }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].others).toHaveLength(1);
  });

  it("never mixes two people's facts into one group", () => {
    const groups = groupClaims([
      claim({ subject_kind: "contact", subject_id: "c1", value: "one@example.com" }),
      claim({ subject_kind: "contact", subject_id: "c2", value: "two@example.com" }),
    ]);
    expect(groups).toHaveLength(2);
  });

  it("groups the same attribute written in different case", () => {
    const groups = groupClaims([
      claim({ attribute: "Email", value: "a@example.com" }),
      claim({ attribute: "email", value: "b@example.com" }),
    ]);
    expect(groups).toHaveLength(1);
  });

  it("returns nothing for nothing", () => {
    expect(groupClaims([])).toEqual([]);
  });

  it("sorts groups by attribute so the list is stable between runs", () => {
    const groups = groupClaims([
      claim({ attribute: "phone", value: "1" }),
      claim({ attribute: "email", value: "2" }),
    ]);
    expect(groups.map((g) => g.attribute)).toEqual(["email", "phone"]);
  });
});
