import { describe, it, expect } from "vitest";
import {
  dateOnly,
  parseLimit,
  parseUpdatedSince,
  slugWithFallback,
  slugify,
  toWorldClaim,
  toWorldEntity,
  toWorldEvent,
  writtenBy,
} from "../world-records";

describe("slugify", () => {
  it("makes a filename out of a name", () => {
    expect(slugify("Peter Mueller")).toBe("peter-mueller");
  });

  it("keeps the letter when it drops the accent", () => {
    // "Muller", never "Mller". A dropped letter makes a different person.
    expect(slugify("Müller")).toBe("muller");
    expect(slugify("Renée Dupont")).toBe("renee-dupont");
  });

  it("collapses punctuation instead of leaving it in a filename", () => {
    expect(slugify("Ownward Studio (GmbH)")).toBe("ownward-studio-gmbh");
    expect(slugify("  spaced  out  ")).toBe("spaced-out");
  });

  it("returns nothing when a name carries nothing a filename can hold", () => {
    // The caller adds the id, because only the caller can make it unique.
    expect(slugify("")).toBe("");
    expect(slugify(null)).toBe("");
  });
});

describe("slugWithFallback", () => {
  it("uses the name when there is one", () => {
    expect(slugWithFallback("Peter", "abcdef12-3456", "entity")).toBe("peter");
  });

  it("falls back to the id, so two unnameable rows never collide", () => {
    const a = slugWithFallback("", "aaaaaaaa-1111", "entity");
    const b = slugWithFallback("", "bbbbbbbb-2222", "entity");
    expect(a).toBe("entity-aaaaaaaa");
    expect(a).not.toBe(b);
  });
});

describe("writtenBy", () => {
  it("calls a hand-typed fact human", () => {
    expect(writtenBy("user_manual")).toBe("human");
  });

  it("calls everything else machine, including an unknown origin", () => {
    // The safe default: claiming Michael said something he did not is the
    // expensive mistake, so anything unrecognised is treated as machine work.
    expect(writtenBy("ai_note")).toBe("machine");
    expect(writtenBy("normalizer")).toBe("machine");
    expect(writtenBy(null)).toBe("machine");
    expect(writtenBy("something-new")).toBe("machine");
  });
});

describe("dateOnly", () => {
  it("keeps the day and drops the clock", () => {
    expect(dateOnly("2026-08-16T14:03:22.123Z")).toBe("2026-08-16");
    expect(dateOnly("2026-08-16")).toBe("2026-08-16");
  });

  it("returns nothing for a missing date", () => {
    expect(dateOnly(null)).toBeNull();
    expect(dateOnly("")).toBeNull();
  });
});

describe("toWorldEntity", () => {
  it("carries the fields a hub file needs", () => {
    const entity = toWorldEntity({
      id: "e1",
      name: "Ownward Studio",
      kind: "org",
      aliases: ["OWN", null],
      description: "The publishing company.",
      updated_at: "2026-08-16T00:00:00Z",
    });
    expect(entity.slug).toBe("ownward-studio");
    expect(entity.kind).toBe("org");
    expect(entity.aliases).toEqual(["OWN"]);
  });

  it("defaults a missing kind rather than writing an empty one", () => {
    expect(toWorldEntity({ id: "e2", name: "Thing", kind: null }).kind).toBe("other");
  });
});

describe("toWorldEvent", () => {
  it("names the file by date first, so the folder sorts by time", () => {
    const event = toWorldEvent({
      id: "m1",
      title: "Ownward Studio refounded",
      happened_at: "2026-08-06T09:00:00Z",
    });
    expect(event.slug).toBe("2026-08-06-ownward-studio-refounded");
    expect(event.date).toBe("2026-08-06");
  });

  it("says undated instead of inventing a date", () => {
    expect(toWorldEvent({ id: "m2", title: "Someday", happened_at: null }).slug)
      .toBe("undated-someday");
  });

  it("lists the person it happened with", () => {
    expect(toWorldEvent({ id: "m3", title: "Lunch", person_id: "c9" }).participants)
      .toEqual(["c9"]);
    expect(toWorldEvent({ id: "m4", title: "Alone", person_id: null }).participants)
      .toEqual([]);
  });
});

describe("toWorldClaim", () => {
  it("marks a hand-typed claim as written by a human", () => {
    const claim = toWorldClaim({
      id: "p1",
      subject_kind: "self",
      attribute: "email",
      value: "michael@zelbel.de",
      origin: "user_manual",
      rank: "preferred",
    });
    expect(claim.written_by).toBe("human");
    expect(claim.rank).toBe("preferred");
  });

  it("marks an extracted claim as written by a machine and normal", () => {
    const claim = toWorldClaim({
      id: "p2",
      subject_kind: "contact",
      subject_id: "c1",
      attribute: "employer",
      value: "Somewhere",
      origin: "ai_note",
    });
    expect(claim.written_by).toBe("machine");
    expect(claim.rank).toBe("normal");
  });

  it("keeps both dates of a relationship that ended", () => {
    const claim = toWorldClaim({
      id: "r1",
      attribute: "relationship",
      value: "co-worker",
      valid_from: "2024-03-01",
      valid_to: "2026-01-31T00:00:00Z",
      origin: "user_manual",
    });
    expect(claim.valid_from).toBe("2024-03-01");
    expect(claim.valid_to).toBe("2026-01-31");
  });
});

describe("parseUpdatedSince", () => {
  it("accepts a plain day and reads it as the start of that day", () => {
    const { value, error } = parseUpdatedSince("2026-08-16");
    expect(error).toBeNull();
    expect(value).toBe("2026-08-16T00:00:00.000Z");
  });

  it("accepts a full timestamp", () => {
    expect(parseUpdatedSince("2026-08-16T12:30:00Z").value).toBe("2026-08-16T12:30:00.000Z");
  });

  it("means everything when it is absent", () => {
    expect(parseUpdatedSince(undefined)).toEqual({ value: null, error: null });
    expect(parseUpdatedSince("  ")).toEqual({ value: null, error: null });
  });

  it("refuses nonsense instead of quietly returning the whole world", () => {
    const { value, error } = parseUpdatedSince("last tuesday");
    expect(value).toBeNull();
    expect(error).toContain("updated_since");
  });
});

describe("parseLimit", () => {
  it("uses the default when nothing is asked for", () => {
    expect(parseLimit(null)).toBe(500);
  });

  it("caps a caller who asks for too much", () => {
    expect(parseLimit("999999")).toBe(2000);
  });

  it("ignores a value that is not a positive number", () => {
    expect(parseLimit("0")).toBe(500);
    expect(parseLimit("-5")).toBe(500);
    expect(parseLimit("many")).toBe(500);
  });
});
