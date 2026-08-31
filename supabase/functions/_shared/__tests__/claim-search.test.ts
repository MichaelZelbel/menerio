import { describe, it, expect } from "vitest";
import {
  flagConflicts,
  flagStale,
  judgeDayFor,
  renderClaimHit,
  toClaimHits,
  type ClaimHit,
} from "../claim-search";

/**
 * The claim arm of search, which now answers BOTH the MCP server and the
 * in-app assistant. It had no tests while it had one caller; it has two now,
 * and the whole point of sharing it is that they cannot answer differently.
 */

function hit(over: Partial<ClaimHit> = {}): ClaimHit {
  return {
    kind: "claim",
    id: over.id ?? "id-1",
    subject_type: "self",
    subject_id: null,
    subject: "you",
    attribute: "current-street",
    value: "Forstwaldstraße 365",
    valid_from: "2026-08-31",
    valid_to: null,
    confidence: "likely",
    cardinality: "one",
    review_by: null,
    evidence_quote: null,
    source_type: null,
    source_id: null,
    similarity: 0.41,
    ...over,
  };
}

describe("flagConflicts", () => {
  it("reports two live answers to one single-valued question, on both rows", () => {
    const out = flagConflicts([
      hit({ id: "a", attribute: "manager", value: "Phil Benton" }),
      hit({ id: "b", attribute: "manager", value: "Gunther Reinhard" }),
    ]);
    expect(out[0].conflicts_with).toEqual(["Gunther Reinhard"]);
    expect(out[1].conflicts_with).toEqual(["Phil Benton"]);
  });

  it("never flags a many-valued attribute, where several answers are normal", () => {
    const out = flagConflicts([
      hit({ id: "a", attribute: "favourite-restaurant", value: "Osteria", cardinality: "many" }),
      hit({ id: "b", attribute: "favourite-restaurant", value: "Kim Chi", cardinality: "many" }),
    ]);
    expect(out.every((h) => h.conflicts_with === undefined)).toBe(true);
  });

  it("treats the same value written twice as duplication, not disagreement", () => {
    const out = flagConflicts([
      hit({ id: "a", value: "Forstwaldstraße 365" }),
      hit({ id: "b", value: "  forstwaldstrasse 365 ".replace("strasse", "straße").trim() }),
    ]);
    expect(out[0].conflicts_with).toBeUndefined();
  });

  it("keeps two people's answers apart, even under the same attribute", () => {
    const out = flagConflicts([
      hit({ id: "a", subject_type: "contact", subject_id: "c1", value: "Berlin" }),
      hit({ id: "b", subject_type: "contact", subject_id: "c2", value: "Krefeld" }),
    ]);
    expect(out.every((h) => h.conflicts_with === undefined)).toBe(true);
  });
});

describe("flagStale", () => {
  it("marks a live fact whose review date has passed", () => {
    const out = flagStale([hit({ review_by: "2026-08-12" })], "2026-08-31");
    expect(out[0].stale_since).toBe("2026-08-12");
  });

  it("leaves a fact still inside its window alone", () => {
    const out = flagStale([hit({ review_by: "2026-09-30" })], "2026-08-31");
    expect(out[0].stale_since).toBeNull();
  });

  it("never marks a superseded fact — history is not rot", () => {
    const out = flagStale([hit({ review_by: "2026-08-12", valid_to: "2026-08-20" })], "2026-08-31");
    expect(out[0].stale_since).toBeNull();
  });

  it("leaves a fact with no review date alone forever", () => {
    const out = flagStale([hit({ review_by: null })], "2999-01-01");
    expect(out[0].stale_since).toBeNull();
  });
});

describe("judgeDayFor", () => {
  it("uses the date the caller named", () => {
    expect(judgeDayFor("2026-01-01", [hit()], "2026-08-31")).toBe("2026-01-01");
  });

  it("uses UTC today when nothing in the result set is newer", () => {
    expect(judgeDayFor(null, [hit({ valid_from: "2026-01-05" })], "2026-08-31")).toBe("2026-08-31");
  });

  it("follows the user past UTC midnight rather than judging their day as yesterday", () => {
    // A user at UTC+2 states a fact at 00:30 local. Their date is the 1st
    // while the server is still on the 31st. Judging staleness on the server's
    // day is the bug that made freshly written facts look wrong.
    expect(judgeDayFor(null, [hit({ valid_from: "2026-09-01" })], "2026-08-31")).toBe("2026-09-01");
  });

  it("survives a result set with no dates at all", () => {
    expect(judgeDayFor(null, [hit({ valid_from: null })], "2026-08-31")).toBe("2026-08-31");
  });
});

describe("toClaimHits", () => {
  it("names the user 'you' and a contact by their name", () => {
    const out = toClaimHits(
      [
        { id: "a", subject_type: "self", subject_id: null, attribute: "phone", value: "+49.172.2347850" },
        { id: "b", subject_type: "contact", subject_id: "c1", attribute: "employer", value: "SAP" },
      ],
      (kind, id) => (kind === "self" ? "you" : id === "c1" ? "Klaus" : "someone"),
    );
    expect(out[0].subject).toBe("you");
    expect(out[1].subject).toBe("Klaus");
  });

  it("leaves a missing field null rather than guessing it", () => {
    // A cardinality we do not know must be absent, not defaulted to "one":
    // guessing "one" is what would report every extra favourite restaurant as
    // a contradiction for ever.
    const [out] = toClaimHits([{ id: "a", attribute: "x", value: "y" }], () => "you");
    expect(out.cardinality).toBeNull();
    expect(out.review_by).toBeNull();
    expect(out.valid_from).toBeNull();
  });
});

describe("renderClaimHit", () => {
  it("prints the value with the dates that are its whole advantage over a note", () => {
    const text = renderClaimHit(hit());
    expect(text).toContain("[claim] you — current-street: Forstwaldstraße 365");
    expect(text).toContain("2026-08-31 to now");
    expect(text).toContain("41% match");
  });

  it("tells the reader to use a stale fact AND say when it was last checked", () => {
    const text = renderClaimHit({ ...hit(), stale_since: "2026-08-12" });
    expect(text).toContain("NOT CONFIRMED SINCE 2026-08-12");
    expect(text).toMatch(/say when it was last checked/i);
  });

  it("tells the reader to report every colliding value and pick none", () => {
    const text = renderClaimHit({ ...hit(), conflicts_with: ["Gunther Reinhard"] });
    expect(text).toContain("DISAGREES WITH: Gunther Reinhard");
    expect(text).toMatch(/do not pick one/i);
  });

  it("carries the sentence the fact came from and the note it is in", () => {
    const text = renderClaimHit({
      ...hit(),
      evidence_quote: "Forstwaldstraße 365, Postal code: 47804",
      source_type: "note",
      source_id: "note-42",
    });
    expect(text).toContain('"Forstwaldstraße 365, Postal code: 47804"');
    expect(text).toContain("from note note-42");
  });

  it("says 'undated' rather than inventing a date it does not have", () => {
    const text = renderClaimHit(hit({ valid_from: null, valid_to: null }));
    expect(text).toContain("undated");
  });
});
