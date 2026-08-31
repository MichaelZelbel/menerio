import { describe, it, expect } from "vitest";
import {
  claimCovers,
  dayOf,
  planPromotions,
  type ContactVisibility,
  type EntryRow,
  type ExistingClaim,
} from "../promote-entries";

function entry(over: Partial<EntryRow> = {}): EntryRow {
  return {
    id: over.id ?? "e1",
    contact_id: null,
    label: "Current Street",
    value: "Forstwaldstraße 365",
    origin: "unverified",
    evidence_quote: null,
    linked_note_id: null,
    derived_from_claim_id: null,
    created_at: "2026-03-08T10:00:00+00:00",
    ...over,
  };
}

function claim(over: Partial<ExistingClaim> = {}): ExistingClaim {
  return {
    id: over.id ?? "c1",
    subject_type: "self",
    subject_id: null,
    attribute: "current-street",
    value: "Forstwaldstraße 365",
    valid_to: null,
    ...over,
  };
}

const visible: ContactVisibility[] = [{ id: "p1", is_sensitive: false, ai_visibility: "visible" }];

describe("dayOf", () => {
  it("takes the calendar day out of a timestamp", () => {
    expect(dayOf("2026-03-08T23:59:00+00:00")).toBe("2026-03-08");
  });
});

describe("claimCovers", () => {
  it("accepts a claim that holds the entry's value in full", () => {
    expect(claimCovers("Forstwaldstraße 365, 47804", "Forstwaldstraße 365")).toBe(true);
  });

  it("refuses to let a subset hide its superset", () => {
    // The Email entry holds two addresses; a one-address claim must not hide
    // it, or the second address vanishes from the mirror with nothing
    // reporting it.
    expect(claimCovers("michael@goodlightmag.com", "michael@goodlightmag.com, michael@zelbel.de")).toBe(false);
  });

  it("ignores case and surrounding space", () => {
    expect(claimCovers("  SAP  ", "sap")).toBe(true);
  });

  it("never covers an empty value", () => {
    expect(claimCovers("anything", "   ")).toBe(false);
  });
});

describe("planPromotions", () => {
  it("promotes a plain entry into a dated claim", () => {
    const plan = planPromotions([entry()], [], []);
    expect(plan.promote).toHaveLength(1);
    const p = plan.promote[0];
    expect(p.attribute).toBe("current-street");
    expect(p.value).toBe("Forstwaldstraße 365");
    expect(p.subject_type).toBe("self");
    expect(p.subject_id).toBeNull();
    expect(p.entry_ids).toEqual(["e1"]);
  });

  it("dates the claim from the day the entry went on record", () => {
    const [p] = planPromotions([entry()], [], []).promote;
    expect(p.valid_from).toBe("2026-03-08");
    // current-street is 365 days in the registry.
    expect(p.review_by).toBe("2027-03-08");
  });

  it("gives a never-reviewed attribute no review date", () => {
    const [p] = planPromotions([entry({ label: "Date of Birth", value: "1976-02-14" })], [], []).promote;
    expect(p.attribute).toBe("date-of-birth");
    expect(p.review_by).toBeNull();
  });

  it("hyphenates and lowercases a multi-word label", () => {
    const [p] = planPromotions([entry({ label: "  Duolingo   Streak " })], [], []).promote;
    expect(p.attribute).toBe("duolingo-streak");
  });

  it("CARRIES a hand-typed origin instead of demoting it to a machine's", () => {
    // Losing user_manual here is what would let a later job overwrite a value
    // Michael typed. It is the whole reason claims grew an origin column.
    const [p] = planPromotions([entry({ origin: "user_manual", label: "Location", value: "UK" })], [], []).promote;
    expect(p.origin).toBe("user_manual");
    expect(p.value).toBe("UK");
    expect(p.source_type).toBe("manual");
  });

  it("never changes the words of a hand-typed value", () => {
    const odd = "  UK (still?) ";
    const [p] = planPromotions([entry({ origin: "user_manual", label: "Location", value: odd })], [], []).promote;
    expect(p.value).toBe(odd.trim());
  });

  it("carries the note a fact came from", () => {
    const [p] = planPromotions([entry({ linked_note_id: "n7", evidence_quote: "I live at Forstwaldstraße 365" })], [], []).promote;
    expect(p.source_type).toBe("note");
    expect(p.source_id).toBe("n7");
    expect(p.evidence_quote).toBe("I live at Forstwaldstraße 365");
  });

  it("skips an entry that already displays a claim", () => {
    const plan = planPromotions([entry({ derived_from_claim_id: "c9" })], [], []);
    expect(plan.promote).toHaveLength(0);
    expect(plan.skip[0].reason).toBe("already-promoted");
  });

  it("skips a relationship, which belongs in contact_relationships", () => {
    const plan = planPromotions([entry({ label: "Relationship", value: "wife" })], [], []);
    expect(plan.skip[0].reason).toBe("reserved-attribute");
  });

  it("skips an entry with nothing to carry", () => {
    expect(planPromotions([entry({ value: "   " })], [], []).skip[0].reason).toBe("empty");
    expect(planPromotions([entry({ label: "" })], [], []).skip[0].reason).toBe("empty");
  });

  it("LINKS rather than re-inserts when a live claim already holds the value", () => {
    const plan = planPromotions([entry()], [claim()], []);
    expect(plan.promote).toHaveLength(0);
    expect(plan.link).toEqual([{ entry_id: "e1", claim_id: "c1", label: "Current Street" }]);
  });

  it("ignores a closed claim, because history must not block a new fact", () => {
    const plan = planPromotions([entry()], [claim({ valid_to: "2026-01-01" })], []);
    expect(plan.promote).toHaveLength(1);
    expect(plan.link).toHaveLength(0);
  });

  it("asks Michael instead of merging when a live claim disagrees", () => {
    const plan = planPromotions([entry({ label: "Manager", value: "Phil Benton" })], [claim({ attribute: "manager", value: "Gunther Reinhard" })], []);
    expect(plan.promote).toHaveLength(0);
    expect(plan.skip[0].reason).toBe("collision-needs-michael");
    expect(plan.skip[0].detail).toContain("Gunther Reinhard");
    expect(plan.skip[0].detail).toContain("Phil Benton");
  });

  it("asks Michael when two entries in the same run disagree on one question", () => {
    const plan = planPromotions(
      [entry({ id: "a", label: "Manager", value: "Phil Benton" }), entry({ id: "b", label: "Manager", value: "Gunther Reinhard" })],
      [],
      [],
    );
    expect(plan.promote).toHaveLength(0);
    expect(plan.skip.map((s) => s.entry_id).sort()).toEqual(["a", "b"]);
    expect(plan.skip.every((s) => s.reason === "collision-needs-michael")).toBe(true);
  });

  it("lets a many-valued attribute have several live answers", () => {
    const plan = planPromotions(
      [entry({ id: "a", label: "Email", value: "michael@zelbel.de" }), entry({ id: "b", label: "Email", value: "michael@goodlightmag.com" })],
      [],
      [],
    );
    expect(plan.promote).toHaveLength(2);
    expect(plan.promote.every((p) => p.cardinality === "many")).toBe(true);
  });

  it("lets the live attribute_rules registry override the built-in cardinality", () => {
    const plan = planPromotions(
      [entry({ id: "a", label: "Nickname", value: "Mike" }), entry({ id: "b", label: "Nickname", value: "Michi" })],
      [],
      [],
      { nickname: { cardinality: "many" } },
    );
    expect(plan.promote).toHaveLength(2);
  });

  it("writes one claim for two entries that say the same thing", () => {
    const plan = planPromotions(
      [entry({ id: "a" }), entry({ id: "b", value: "  forstwaldstraSSE 365 ".replace("SSE", "ße").trim() })],
      [],
      [],
    );
    expect(plan.promote).toHaveLength(1);
    expect(plan.promote[0].entry_ids.sort()).toEqual(["a", "b"]);
  });

  it("promotes a visible contact's fact as a claim about that contact", () => {
    const plan = planPromotions([entry({ contact_id: "p1", label: "Employer", value: "SAP" })], [], visible);
    expect(plan.promote[0].subject_type).toBe("contact");
    expect(plan.promote[0].subject_id).toBe("p1");
  });

  it("never promotes a fact about a contact the user hid from AI", () => {
    const hidden: ContactVisibility[] = [{ id: "p1", is_sensitive: true, ai_visibility: "visible" }];
    const plan = planPromotions([entry({ contact_id: "p1", label: "Employer", value: "SAP" })], [], hidden);
    expect(plan.promote).toHaveLength(0);
    expect(plan.skip[0].reason).toBe("contact-hidden-from-ai");

    const invisible: ContactVisibility[] = [{ id: "p1", is_sensitive: false, ai_visibility: "hidden" }];
    expect(planPromotions([entry({ contact_id: "p1" })], [], invisible).skip[0].reason).toBe("contact-hidden-from-ai");

    // A contact that could not be loaded at all is treated as hidden, never as
    // visible. Failing open here would leak the exact rows the flag protects.
    expect(planPromotions([entry({ contact_id: "p1" })], [], []).skip[0].reason).toBe("contact-hidden-from-ai");
  });

  it("keeps two people's answers to the same question apart", () => {
    const two: ContactVisibility[] = [
      { id: "p1", is_sensitive: false, ai_visibility: "visible" },
      { id: "p2", is_sensitive: false, ai_visibility: "visible" },
    ];
    const plan = planPromotions(
      [entry({ id: "a", contact_id: "p1", label: "Employer", value: "SAP" }), entry({ id: "b", contact_id: "p2", label: "Employer", value: "Google" })],
      [],
      two,
    );
    expect(plan.promote).toHaveLength(2);
    expect(plan.skip).toHaveLength(0);
  });

  it("does not let one person's claim block another person's entry", () => {
    const plan = planPromotions(
      [entry({ contact_id: "p1", label: "Employer", value: "SAP" })],
      [claim({ subject_type: "contact", subject_id: "p2", attribute: "employer", value: "Google" })],
      visible,
    );
    expect(plan.promote).toHaveLength(1);
  });

  it("closes nothing — the plan only ever inserts or skips", () => {
    const plan = planPromotions(
      [entry({ label: "Manager", value: "Phil Benton" })],
      [claim({ attribute: "manager", value: "Gunther Reinhard" })],
      [],
    );
    expect(Object.keys(plan)).toEqual(["promote", "link", "skip"]);
    expect(plan.promote).toHaveLength(0);
  });
});
