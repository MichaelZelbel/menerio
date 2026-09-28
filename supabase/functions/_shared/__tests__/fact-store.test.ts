import { describe, expect, it } from "vitest";
import { planFacts, suppressionKey, type ExistingClaim, type FactInput, type PlanContext } from "../fact-store.ts";

const self = { type: "self" as const, id: null };
const today = "2026-09-29";

function ctx(over: Partial<PlanContext> = {}): PlanContext {
  return { claims: [], slots: [], rules: {}, suppressed: new Set(), isHuman: false, today, ...over };
}
function claim(over: Partial<ExistingClaim>): ExistingClaim {
  return { id: "c1", attribute: "current-city", value: "Berlin", valid_from: null, valid_to: null, rank: "normal", ...over };
}
const machine = (over: Partial<FactInput> = {}): FactInput => ({
  subject: self, label: "Current city", value: "London", origin: "ai_note",
  evidenceQuote: "I moved to London in spring.", categorySlug: "location", ...over,
});
const human = (over: Partial<FactInput> = {}): FactInput => ({
  subject: self, label: "Current city", value: "London", origin: "user_manual", categorySlug: "location", ...over,
});
const inserts = (plan: ReturnType<typeof planFacts>) => plan.filter((p) => p.kind === "insert") as Array<Extract<ReturnType<typeof planFacts>[number], { kind: "insert" }>>;

describe("planFacts", () => {
  it("a new single value closes the older, non-preferred one", () => {
    const [p] = inserts(planFacts(machine(), ctx({ claims: [claim({})] })));
    expect(p.close).toEqual(["c1"]);
    expect(p.closeOn).toBe(today);
    expect(p.conflict).toBe(false);
  });

  it("a machine never closes a human's value: it adds alongside, as two answers", () => {
    const [p] = inserts(planFacts(machine(), ctx({ claims: [claim({ rank: "preferred" })] })));
    expect(p.close).toEqual([]);
    expect(p.conflict).toBe(true);
  });

  it("a human replaces their own preferred value", () => {
    const [p] = inserts(planFacts(human({ validFrom: "2026-09-01" }), ctx({ isHuman: true, claims: [claim({ rank: "preferred" })] })));
    expect(p.close).toEqual(["c1"]);
    expect(p.closeOn).toBe("2026-09-01");
  });

  it("the same value again is a no-op", () => {
    const plan = planFacts(machine({ value: "berlin " }), ctx({ claims: [claim({})] }));
    expect(plan).toEqual([{ kind: "already_recorded", attribute: "current-city", claimId: "c1" }]);
  });

  it("a machine does not bring back a value that is history", () => {
    const plan = planFacts(machine({ value: "Berlin" }), ctx({ claims: [claim({ valid_to: "2025-01-01" }), claim({ id: "c2", value: "London" })] }));
    expect(plan[0]).toMatchObject({ kind: "history_not_revived", claimId: "c1" });
  });

  it("a human may bring an old value back", () => {
    const [p] = inserts(planFacts(human({ value: "Berlin" }), ctx({ isHuman: true, claims: [claim({ valid_to: "2025-01-01" }), claim({ id: "c2", value: "London" })] })));
    expect(p.close).toEqual(["c2"]);
  });

  it("many-valued attributes (attribute_rules) add instead of replacing", () => {
    const [p] = inserts(planFacts(machine({ label: "Hobbies", value: "Chess", categorySlug: "hobbies", evidenceQuote: "He plays chess on Sundays." }),
      ctx({ rules: { hobbies: "many" }, claims: [claim({ attribute: "hobbies", value: "Running" })] })));
    expect(p.cardinality).toBe("many");
    expect(p.close).toEqual([]);
  });

  it("canonical list-valued labels hold several values even without a rule (Language, not languages)", () => {
    const [p] = inserts(planFacts(machine({ label: "Languages", value: "French", categorySlug: "identity", evidenceQuote: "She also speaks French." }),
      ctx({ rules: { languages: "many" }, claims: [claim({ attribute: "language", value: "German" })] })));
    expect(p.cardinality).toBe("many");
    expect(p.close).toEqual([]);
  });

  it("the slot's own cardinality wins over the rules", () => {
    const [p] = inserts(planFacts(machine(), ctx({ slots: [{ attribute: "current-city", cardinality: "many" }], claims: [claim({})] })));
    expect(p.close).toEqual([]);
  });

  it("a suppressed value is refused", () => {
    const key = suppressionKey(self, "current-city", "London");
    expect(planFacts(machine(), ctx({ suppressed: new Set([key]) }))).toEqual([{ kind: "suppressed", attribute: "current-city" }]);
  });

  it("a bag is split into single facts", () => {
    const plan = inserts(planFacts(human({ label: "Languages", value: "German, English, French", categorySlug: "identity" }), ctx({ isHuman: true })));
    expect(plan.map((p) => p.value)).toEqual(["German", "English", "French"]);
    expect(new Set(plan.map((p) => p.cardinality))).toEqual(new Set(["many"]));
  });

  it("automated origins need a source quote; a human does not", () => {
    expect(planFacts(machine({ evidenceQuote: null }), ctx())).toEqual([{ kind: "rejected", attribute: null, reason: "evidence_required" }]);
    expect(inserts(planFacts(human(), ctx({ isHuman: true })))).toHaveLength(1);
  });

  it("relationships are links, not facts", () => {
    expect(planFacts(human({ label: "Relationship", value: "Married to Kim" }), ctx({ isHuman: true }))[0]).toMatchObject({ kind: "rejected" });
  });

  it("a future-dated change leaves a later live value alone", () => {
    const [p] = inserts(planFacts(human({ validFrom: "2026-10-01" }), ctx({ isHuman: true, claims: [claim({}), claim({ id: "c9", value: "Paris", valid_from: "2026-12-01" })] })));
    expect(p.close).toEqual(["c1"]);
  });

  it("an explicit attribute is kept as is (an old slot keyed 'languages' stays 'languages')", () => {
    const [p] = inserts(planFacts(human({ label: "Languages", attribute: "languages", value: "French, Spanish" }),
      ctx({ isHuman: true, rules: { languages: "many" }, claims: [claim({ attribute: "languages", value: "German" })] })));
    expect(p.attribute).toBe("languages");
    expect(p.value).toBe("French, Spanish");
    expect(p.close).toEqual([]);
  });

  it("no plan step carries a value in its reason", () => {
    const secret = "Top-secret-diagnosis";
    const plan = planFacts(machine({ value: secret, evidenceQuote: null }), ctx());
    expect(JSON.stringify(plan)).not.toContain(secret);
  });
});
