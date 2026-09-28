import { describe, it, expect } from "vitest";
import { entryOriginFor, placeClaim, planAdoptions, type AdoptClaim, type AdoptEntry } from "../adopt-claims";

function claim(over: Partial<AdoptClaim> = {}): AdoptClaim {
  return {
    id: over.id ?? "c1",
    subject_type: "contact",
    subject_id: "p1",
    attribute: "gender",
    value: "girl",
    valid_to: null,
    origin: "unverified",
    source_type: "ai",
    source_id: null,
    evidence_quote: null,
    ...over,
  };
}

function entry(over: Partial<AdoptEntry> = {}): AdoptEntry {
  return { id: over.id ?? "e1", contact_id: "p1", value: "145 cm", derived_from_claim_id: null, ...over };
}

describe("placeClaim", () => {
  it("files a known attribute under its canonical label and section", () => {
    expect(placeClaim("gender")).toEqual({ label: "Gender", categorySlug: "identity" });
  });

  it("files an unknown attribute under Preferences with a readable label", () => {
    expect(placeClaim("loves-tv-show")).toEqual({ label: "Loves tv show", categorySlug: "preferences" });
  });
});

describe("planAdoptions", () => {
  it("adopts a live claim the profile does not show", () => {
    const plan = planAdoptions([claim()], [entry()]);
    expect(plan.adopt).toHaveLength(1);
    expect(plan.adopt[0]).toMatchObject({ claim_id: "c1", label: "Gender", category_slug: "identity", value: "girl" });
  });

  it("leaves a claim alone that an entry already displays", () => {
    const plan = planAdoptions([claim()], [entry({ value: "girl", derived_from_claim_id: "c1" })]);
    expect(plan).toEqual({ adopt: [], link: [], skip: [] });
  });

  it("links an unlinked entry holding the same value instead of adding a second row", () => {
    const plan = planAdoptions([claim()], [entry({ id: "e9", value: "Girl" })]);
    expect(plan.adopt).toEqual([]);
    expect(plan.link).toEqual([{ entry_id: "e9", claim_id: "c1" }]);
  });

  it("skips a copy of a value already shown for another claim", () => {
    const plan = planAdoptions([claim()], [entry({ value: "girl", derived_from_claim_id: "c0" })]);
    expect(plan.adopt).toEqual([]);
    expect(plan.skip).toEqual([{ claim_id: "c1", reason: "same-value-shown" }]);
  });

  it("adopts two claims with one value only once", () => {
    const plan = planAdoptions([claim({ id: "a" }), claim({ id: "b", attribute: "sex" })], []);
    expect(plan.adopt.map((a) => a.claim_id)).toEqual(["a"]);
    expect(plan.skip).toEqual([{ claim_id: "b", reason: "same-value-shown" }]);
  });

  it("never adopts ended claims, relationships, or other subjects", () => {
    const plan = planAdoptions([
      claim({ id: "ended", valid_to: "2026-09-01" }),
      claim({ id: "rel", attribute: "relationship", value: "sister of Ana" }),
      claim({ id: "self", subject_type: "self", subject_id: null }),
    ], []);
    expect(plan.adopt).toEqual([]);
    expect(plan.skip).toEqual([{ claim_id: "rel", reason: "reserved-attribute" }]);
  });

  it("keeps a note claim's source note and falls back to unverified for an unknown origin", () => {
    const plan = planAdoptions([claim({ source_type: "note", source_id: "n1", origin: "weird" })], []);
    expect(plan.adopt[0]).toMatchObject({ linked_note_id: "n1", origin: "unverified" });
  });
});

describe("entryOriginFor", () => {
  it("keeps a quoted origin, and never invents a quote for an unquoted one", () => {
    expect(entryOriginFor({ origin: "ai_note", evidence_quote: "she said she is 145 cm" })).toBe("ai_note");
    expect(entryOriginFor({ origin: "ai_note", evidence_quote: null })).toBe("unverified");
    expect(entryOriginFor({ origin: "menerio", evidence_quote: "a quote long enough" })).toBe("mcp");
    expect(entryOriginFor({ origin: "menerio", evidence_quote: "" })).toBe("unverified");
    expect(entryOriginFor({ origin: "user_manual", evidence_quote: null })).toBe("user_manual");
  });
});
