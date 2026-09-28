import { describe, expect, it } from "vitest";
import { planBagSplit } from "../bag-split.ts";

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
});
