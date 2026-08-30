import { describe, it, expect } from "vitest";
import {
  cardinalityFor,
  claimsToSupersede,
  isStale,
  MANY_VALUED_ATTRIBUTES,
  reviewByFor,
  reviewDaysFor,
  type Claim,
} from "../claims";

function claim(over: Partial<Claim>): Claim {
  return {
    id: Math.random().toString(36).slice(2),
    user_id: "u",
    subject_type: "self",
    subject_id: null,
    attribute: "employer",
    value: "Acme",
    value_json: null,
    valid_from: null,
    valid_to: null,
    confidence: "likely",
    cardinality: "one",
    evidence_quote: null,
    review_by: null,
    source_type: "ai",
    source_id: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...over,
  };
}

describe("cardinalityFor", () => {
  it("defaults an unknown attribute to one", () => {
    expect(cardinalityFor("employer")).toBe("one");
    expect(cardinalityFor("some-attribute-nobody-registered")).toBe("one");
  });

  it("knows the registered many-valued attributes", () => {
    expect(cardinalityFor("favorite restaurants")).toBe("many");
    expect(cardinalityFor("investments")).toBe("many");
    expect(cardinalityFor("pets")).toBe("many");
  });

  it("normalizes the way the rest of the module does: spaces become dashes", () => {
    expect(cardinalityFor("Favorite Restaurants")).toBe("many");
    expect(cardinalityFor("  favorite   restaurants  ")).toBe("many");
    expect(MANY_VALUED_ATTRIBUTES.has("favorite-restaurants")).toBe(true);
  });

  it("keeps a plural-looking single-valued attribute single", () => {
    // He has lived in many cities; "current city" still holds one value.
    expect(cardinalityFor("current city")).toBe("one");
  });
});

describe("claimsToSupersede", () => {
  const existing = [claim({ attribute: "pets", value: "cat", cardinality: "many" })];

  it("closes the old value on a single-valued attribute", () => {
    const before = [claim({ attribute: "employer", value: "Acme" })];
    const out = claimsToSupersede(before, { attribute: "employer", valid_from: "2026-06-01" });
    expect(out).toHaveLength(1);
  });

  it("closes NOTHING on a many-valued attribute", () => {
    // The bug this guards: adding a second favourite restaurant used to close
    // the first, which is a delete wearing a date.
    const out = claimsToSupersede(existing, { attribute: "pets", valid_from: "2026-06-01" });
    expect(out).toHaveLength(0);
  });

  it("takes an explicit cardinality over the registry", () => {
    const before = [claim({ attribute: "employer", value: "Acme" })];
    const out = claimsToSupersede(before, {
      attribute: "employer",
      valid_from: "2026-06-01",
      cardinality: "many",
    });
    expect(out).toHaveLength(0);
  });

  it("leaves an already-closed claim alone", () => {
    const before = [claim({ attribute: "employer", value: "Acme", valid_to: "2020-01-01" })];
    const out = claimsToSupersede(before, { attribute: "employer", valid_from: "2026-06-01" });
    expect(out).toHaveLength(0);
  });
});

describe("reviewDaysFor", () => {
  it("never re-checks a fact that cannot change", () => {
    expect(reviewDaysFor("date of birth")).toBeNull();
    expect(reviewDaysFor("birthplace")).toBeNull();
    expect(reviewDaysFor("wedding date")).toBeNull();
  });

  it("re-checks a counter within weeks", () => {
    expect(reviewDaysFor("duolingo streak")).toBe(14);
    expect(reviewDaysFor("body weight")).toBe(14);
  });

  it("re-checks a job or an address yearly", () => {
    expect(reviewDaysFor("employer")).toBe(365);
    expect(reviewDaysFor("current city")).toBe(365);
  });

  it("gives both halves of the manager split the same interval", () => {
    expect(reviewDaysFor("line manager")).toBe(180);
    expect(reviewDaysFor("manager in project")).toBe(180);
  });

  it("falls back to a year for an unregistered attribute", () => {
    expect(reviewDaysFor("some-attribute-nobody-registered")).toBe(365);
  });
});

describe("reviewByFor", () => {
  it("adds the interval to valid_from", () => {
    expect(reviewByFor("employer", "2026-01-01")).toBe("2027-01-01");
    expect(reviewByFor("duolingo streak", "2026-07-29")).toBe("2026-08-12");
  });

  it("returns null for a fact that never needs re-checking", () => {
    expect(reviewByFor("date of birth", "2026-01-01")).toBeNull();
  });

  it("returns null when there is no start date to count from", () => {
    expect(reviewByFor("employer", null)).toBeNull();
  });

  it("returns null rather than a bogus date for unparseable input", () => {
    expect(reviewByFor("employer", "not-a-date")).toBeNull();
  });
});

describe("isStale", () => {
  it("flags a live claim past its review date", () => {
    // The real case: a Duolingo streak stamped 2026-07-29 with a 14-day
    // interval, read on 2026-08-30. Nothing contradicts it and it is wrong.
    expect(isStale({ review_by: "2026-08-12", valid_to: null }, "2026-08-30")).toBe(true);
  });

  it("does not flag one whose review date is still ahead", () => {
    expect(isStale({ review_by: "2027-01-01", valid_to: null }, "2026-08-30")).toBe(false);
  });

  it("never flags a fact that needs no review", () => {
    expect(isStale({ review_by: null, valid_to: null }, "2026-08-30")).toBe(false);
  });

  it("does not flag an already-closed claim: it is history, not rot", () => {
    expect(isStale({ review_by: "2020-01-01", valid_to: "2021-01-01" }, "2026-08-30")).toBe(false);
  });
});
