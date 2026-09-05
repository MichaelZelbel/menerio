import { describe, it, expect } from "vitest";
import { pickExistingContact, sameName, type ContactCandidate } from "../find-or-create-contact";

function c(over: Partial<ContactCandidate> = {}): ContactCandidate {
  return {
    id: over.id ?? "c1",
    name: over.name ?? "Cal Newport",
    aliases: over.aliases ?? [],
    merged_into: over.merged_into ?? null,
    created_at: over.created_at ?? "2026-09-04T19:46:36+00:00",
    ...over,
  };
}

describe("sameName", () => {
  it("ignores case and surrounding or doubled space", () => {
    expect(sameName("  cal   NEWPORT ", "Cal Newport")).toBe(true);
  });

  it("does not match a different person", () => {
    expect(sameName("Cal Newport", "Cal Newport Jr")).toBe(false);
  });
});

describe("pickExistingContact", () => {
  // On 2026-09-04 two notes each proposed "Cal Newport" and a bulk keep
  // created one contact per suggestion. Twelve people ended up twice in the
  // owner's hub. The keep must find the person the first keep made.
  it("returns the live contact that carries the name", () => {
    const hit = c({ id: "keep-me" });
    expect(pickExistingContact("cal newport", [hit])?.id).toBe("keep-me");
  });

  it("returns null when nobody carries the name", () => {
    expect(pickExistingContact("Cal Newport", [c({ name: "Carl Newport" })])).toBeNull();
  });

  it("finds a person through an alias", () => {
    const hit = c({ id: "via-alias", name: "Calvin Newport", aliases: ["Cal Newport"] });
    expect(pickExistingContact("Cal Newport", [hit])?.id).toBe("via-alias");
  });

  it("never returns a contact that was merged away", () => {
    expect(pickExistingContact("Cal Newport", [c({ merged_into: "someone-else" })])).toBeNull();
  });

  it("prefers the oldest when several already exist", () => {
    // Two duplicates already there: keep piling onto the first one, never
    // make a third.
    const older = c({ id: "older", created_at: "2026-09-04T19:46:36+00:00" });
    const newer = c({ id: "newer", created_at: "2026-09-04T19:46:39+00:00" });
    expect(pickExistingContact("Cal Newport", [newer, older])?.id).toBe("older");
  });

  it("prefers a name match over an alias match", () => {
    const byAlias = c({ id: "alias", name: "Someone", aliases: ["Cal Newport"], created_at: "2020-01-01T00:00:00+00:00" });
    const byName = c({ id: "name", created_at: "2026-01-01T00:00:00+00:00" });
    expect(pickExistingContact("Cal Newport", [byAlias, byName])?.id).toBe("name");
  });
});
