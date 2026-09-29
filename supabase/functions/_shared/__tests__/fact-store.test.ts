import { describe, expect, it } from "vitest";
import { factWritesPaused, planFacts, suggestionAlreadyKnown, suppressionKey, writeFact, type ExistingClaim, type FactInput, type PlanContext } from "../fact-store.ts";
import { factDb } from "./fact-db.ts";

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

  it("a second change on the same day closes the value that started that day (eleventh review)", () => {
    const london = claim({ id: "london", value: "London", valid_from: today, rank: "preferred" });
    const [p] = inserts(planFacts(human({ value: "Paris", validFrom: today }), ctx({ isHuman: true, claims: [london] })));
    expect(p.close).toEqual(["london"]);
    expect(p.conflict).toBe(false);
  });

  it("a value that starts after the new one is left alone", () => {
    const later = claim({ id: "later", value: "Rome", valid_from: "2026-12-01" });
    const [p] = inserts(planFacts(machine({ validFrom: "2026-10-01" }), ctx({ claims: [later] })));
    expect(p.close).toEqual([]);
  });

  // Review 2026-09-29: an old note read again put its value in as current
  // beside the later one: two answers, and the caller was told nothing.
  it("a backdated machine value ends where the later value on file starts, as history", () => {
    const berlin = claim({ id: "berlin", value: "Berlin", valid_from: "2021-04-01" });
    const [p] = inserts(planFacts(machine({ value: "London", validFrom: "2019-05-01" }), ctx({ claims: [berlin] })));
    expect(p.endsOn).toBe("2021-04-01");
    expect(p.close).toEqual([]);
    expect(p.conflict).toBe(false);
  });

  it("the earliest later start wins, history included", () => {
    const rome = claim({ id: "rome", value: "Rome", valid_from: "2020-01-01", valid_to: "2021-04-01" });
    const berlin = claim({ id: "berlin", value: "Berlin", valid_from: "2021-04-01" });
    const [p] = inserts(planFacts(machine({ value: "London", validFrom: "2019-05-01" }), ctx({ claims: [berlin, rome] })));
    expect(p.endsOn).toBe("2020-01-01");
  });

  it("a value planned for a future day ends today's new value on that day", () => {
    const planned = claim({ id: "paris", value: "Paris", valid_from: "2026-12-01" });
    const [p] = inserts(planFacts(human({ value: "Munich" }), ctx({ isHuman: true, claims: [claim({}), planned] })));
    expect(p.close).toEqual(["c1"]);
    expect(p.endsOn).toBe("2026-12-01");
  });

  it("an open-ended value stays open-ended when nothing later is on file", () => {
    const [p] = inserts(planFacts(machine(), ctx({ claims: [claim({})] })));
    expect(p.endsOn).toBeNull();
  });

  it("a many-valued attribute is never ended by another value", () => {
    const [p] = inserts(planFacts(machine({ label: "Hobbies", value: "Chess", categorySlug: "hobbies", evidenceQuote: "He plays chess on Sundays.", validFrom: "2019-01-01" }),
      ctx({ rules: { hobbies: "many" }, claims: [claim({ attribute: "hobbies", value: "Running", valid_from: "2022-01-01" })] })));
    expect(p.endsOn).toBeNull();
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

// Review 2026-09-29: generate-profile-suggestions showed the model agent_facts
// only, so it suggested a private fact again, into a public section.
describe("suggestionAlreadyKnown", () => {
  const known = [
    { attribute: "health-conditions", value: "ADHD", visibility_scope: "private" },
    { attribute: "current-city", value: "Berlin", visibility_scope: "all" },
  ];
  const none = new Set<string>();

  it("a private value is known under any label", () => {
    expect(suggestionAlreadyKnown(self, { label: "Diagnosis", value: " adhd " }, known, none)).toBe(true);
  });

  it("a shown value is known under its own attribute only", () => {
    expect(suggestionAlreadyKnown(self, { label: "Current city", value: "berlin" }, known, none)).toBe(true);
    expect(suggestionAlreadyKnown(self, { label: "Hometown", value: "Berlin" }, known, none)).toBe(false);
  });

  it("a value the user called wrong is known", () => {
    const wrong = new Set([suppressionKey(self, "hometown", "Paris")]);
    expect(suggestionAlreadyKnown(self, { label: "Hometown", value: "Paris" }, known, wrong)).toBe(true);
    expect(suggestionAlreadyKnown(self, { label: "Hometown", value: "Lyon" }, known, wrong)).toBe(false);
  });
});

describe("writeFact against the database (review 2026-09-29)", () => {
  const U = "u1";

  // Eleventh review: the pieces of a list were stored as 'many' but the slot
  // was not, so the next single value (cardinality from the slot, then the
  // rules, then 'one') ended every piece.
  it("a list it splits marks the slot as holding several, so the next single value adds", async () => {
    const d = factDb({ tables: {} });
    await writeFact(d, U, machine({ label: "Email", value: "a@example.invalid, b@example.invalid", categorySlug: "communication",
      evidenceQuote: "Write to a@example.invalid or b@example.invalid." }), { isHuman: false });
    expect(d.tables.fact_slots.map((s) => [s.attribute, s.cardinality])).toEqual([["email", "many"]]);
    const [p] = inserts(planFacts(machine({ label: "Email", value: "c@example.invalid" }), ctx({
      slots: d.tables.fact_slots.map((s) => ({ attribute: s.attribute, cardinality: s.cardinality, category_slug: s.category_slug })),
      claims: [claim({ id: "a", attribute: "email", value: "a@example.invalid" }), claim({ id: "b", attribute: "email", value: "b@example.invalid" })],
    })));
    expect(p.close).toEqual([]);
  });
  const cityFact = (over: Record<string, unknown> = {}) => ({
    claim_id: "c-old", user_id: U, subject_type: "self" as const, subject_id: null,
    attribute: "current-city", value: "Berlin", origin: "ai_note", ...over,
  });
  /** The database's claim guards refuse a placeholder value (23514), as claim_quality_guard does. */
  function withQualityGuard(db: ReturnType<typeof factDb>) {
    const from = db.from;
    db.from = (table: string) => {
      const q = from(table);
      if (table !== "claims") return q;
      const insert = q.insert;
      q.insert = (v: any) => {
        if (String(v?.value ?? "").trim().toLowerCase() !== "none") return insert(v);
        const refused: any = {
          select: () => refused, maybeSingle: () => refused,
          then: (ok: any, fail: any) => Promise.resolve({ data: null, error: { code: "23514", message: "claim_quality_guard: placeholder" } }).then(ok, fail),
        };
        return refused;
      };
      return q;
    };
    return db;
  }

  it("a value the database refuses leaves the old value current", async () => {
    const db = withQualityGuard(factDb({ facts: [cityFact()] }));
    const r = await writeFact(db, U, human({ value: "none" }), { isHuman: true });
    expect(r.ok).toBe(false);
    expect(db.tables.claims.find((c) => c.id === "c-old")?.valid_to).toBeNull();
  });

  it("a person may type a value that was marked 'do not suggest again'; a machine may not", async () => {
    const key = suppressionKey(self, "current-city", "London");
    const seed = () => ({ facts: [cityFact()], tables: { ai_suggestion_suppressions: [{ user_id: U, suggestion_type: "claim", suppression_key: key }] } });
    const machineDb = factDb(seed());
    expect((await writeFact(machineDb, U, machine(), { isHuman: false })).facts[0].outcome).toBe("suppressed");
    const humanDb = factDb(seed());
    expect((await writeFact(humanDb, U, human(), { isHuman: true })).facts[0].outcome).toBe("inserted");
  });

  it("a fact added to a private section stays there, even when the splitter would file it elsewhere", async () => {
    const db = factDb({ tables: { profile_categories: [{ user_id: U, contact_id: null, slug: "vault", visibility_scope: "private" }] } });
    const r = await writeFact(db, U, human({ label: "Contact", value: "me@example.invalid, +49 30 1234567", categorySlug: "vault" }), { isHuman: true });
    expect(r.facts.length).toBeGreaterThan(0);
    expect(r.facts.every((f) => f.outcome === "inserted")).toBe(true);
    expect(new Set(db.tables.fact_slots.map((s) => s.category_slug))).toEqual(new Set(["vault"]));
  });

  it("a fact added to a private section moves its attribute's public slot there (the most private wins)", async () => {
    const db = factDb({ facts: [cityFact()], tables: {
      profile_categories: [{ user_id: U, contact_id: null, slug: "vault", visibility_scope: "private" }],
      fact_slots: [{ id: "s1", user_id: U, subject_type: "self", subject_id: null, attribute: "current-city", category_slug: "location", cardinality: null }],
    } });
    await writeFact(db, U, human({ categorySlug: "vault" }), { isHuman: true });
    expect(db.tables.fact_slots[0].category_slug).toBe("vault");
  });

  it("the pause flag fails closed: an unreadable flag counts as paused, a missing function does not", async () => {
    const rpc = (error: unknown) => ({ rpc: async () => ({ data: null, error }) });
    expect(await factWritesPaused(rpc({ code: "57014", message: "timeout" }))).toBe(true);
    expect(await factWritesPaused(rpc({ code: "PGRST202", message: "not found" }))).toBe(false);
  });

  it("a backdated machine value goes in as history: one current value, and the caller is told", async () => {
    const db = factDb({ facts: [cityFact({ value: "Berlin", valid_from: "2021-04-01", rank: "preferred", origin: "user_manual" })] });
    const r = await writeFact(db, U, machine({ value: "London", validFrom: "2019-05-01", evidenceQuote: "Back in 2019 I moved to London." }), { isHuman: false });
    expect(r.facts[0]).toMatchObject({ outcome: "inserted", validTo: "2021-04-01", conflict: false });
    const london = db.tables.claims.find((c) => c.value === "London");
    expect(london).toMatchObject({ valid_from: "2019-05-01", valid_to: "2021-04-01" });
    const { data } = await db.from("agent_facts").select("*").eq("user_id", U).eq("is_current", true);
    expect((data as Array<{ value: string }>).map((f) => f.value)).toEqual(["Berlin"]);
  });

  it("a value the user called wrong is refused even past the server's 1,000-row cap", async () => {
    const filler = Array.from({ length: 1200 }, (_, i) => ({
      user_id: U, suggestion_type: "claim", suppression_key: suppressionKey(self, "current-city", `aaa ${String(i).padStart(4, "0")}`),
    }));
    const wrong = { user_id: U, suggestion_type: "claim", suppression_key: suppressionKey(self, "current-city", "London") };
    const db = factDb({ maxRows: 1000, facts: [cityFact()], tables: { ai_suggestion_suppressions: [...filler, wrong] } });
    const r = await writeFact(db, U, machine(), { isHuman: false });
    expect(r.facts[0].outcome).toBe("suppressed");
    expect(db.tables.claims.some((c) => c.value === "London")).toBe(false);
  });

  it("a source quote is counted in characters, as the database counts it", () => {
    expect(planFacts(machine({ evidenceQuote: "😀😀😀😀😀" }), ctx())).toEqual([{ kind: "rejected", attribute: null, reason: "evidence_required" }]);
  });
});
