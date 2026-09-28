import { describe, expect, it } from "vitest";
import { loadBagCandidates, planBagSplit } from "../bag-split.ts";
import { factDb } from "./fact-db.ts";

const bag = (over = {}) => ({ attribute: "language", value: "German, English, French", origin: "unverified", rank: "normal", label: "Language", category_slug: "identity", ...over });

describe("planBagSplit", () => {
  it("splits a machine's bag into pieces under the bag's own attribute", () => {
    const plan = planBagSplit(bag());
    expect(plan.kind).toBe("split");
    if (plan.kind === "split") {
      expect(plan.pieces.map((p) => p.value)).toEqual(["German", "English", "French"]);
      expect(new Set(plan.pieces.map((p) => p.attribute))).toEqual(new Set(["language"]));
    }
  });
  it("leaves a bag a human typed alone", () => {
    expect(planBagSplit(bag({ origin: "user_manual", rank: "preferred" }))).toEqual({ kind: "keep_human" });
    expect(planBagSplit(bag({ rank: "preferred" }))).toEqual({ kind: "keep_human" });
  });
  it("keeps one fact that only looks like a list", () => {
    expect(planBagSplit(bag({ attribute: "current-city", label: "Current city", category_slug: "location", value: "São Paulo, Brazil" })).kind).not.toBe("split");
  });
  it("leaves a bag in a private section alone, so no piece is filed where assistants see it", () => {
    expect(planBagSplit(bag({ visibility_scope: "private", label: "Contact", category_slug: "vault", value: "anna@example.invalid, +49 30 1234567" })))
      .toEqual({ kind: "keep_private" });
  });
});

describe("loadBagCandidates", () => {
  it("finds live values with a comma or a semicolon, once each, without an or-filter", async () => {
    const f = (claim_id: string, value: string, valid_to: string | null = null) =>
      ({ claim_id, user_id: "u1", subject_type: "self" as const, subject_id: null, attribute: "language", value, valid_to });
    const db = factDb({ facts: [f("a", "German, English"), f("b", "Tea; coffee"), f("c", "a, b; c"), f("d", "Solo"), f("e", "Old, list", "2020-01-01")] });
    const rows = await loadBagCandidates(db);
    expect(rows.map((r) => r.claim_id)).toEqual(["a", "b", "c"]);
    expect(db.log.some((q) => q.filters.some((x) => x.startsWith("or:")))).toBe(false);
  });
});
