import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  isBlockedRelationshipLabel,
  profileValueDecision,
  relationshipWriteDecision,
} from "@/lib/profile-integrity";

function sharedCore(path: string): string {
  const text = readFileSync(resolve(process.cwd(), path), "utf8");
  const start = text.indexOf("// --- BEGIN SHARED CORE ---");
  const end = text.indexOf("// --- END SHARED CORE ---");
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return text.slice(start, end);
}

describe("profile integrity mirror", () => {
  it("frontend and edge copies share a byte-identical core", () => {
    expect(sharedCore("src/lib/profile-integrity.ts")).toBe(
      sharedCore("supabase/functions/_shared/profile-integrity.ts"),
    );
  });
});

describe("relationship gate", () => {
  it("rejects junk labels", () => {
    for (const junk of ["subject of notes", "Person Mentioned", "self", "owner", ""]) {
      expect(isBlockedRelationshipLabel(junk)).toBe(true);
    }
    expect(isBlockedRelationshipLabel("wife")).toBe(false);
  });

  it("rejects self-edges", () => {
    expect(
      relationshipWriteDecision({
        userId: "u", sourceType: "contact", sourceId: "a",
        targetType: "contact", targetId: "a", label: "friend",
      }),
    ).toEqual({ ok: false, reason: "self_relationship" });
    expect(
      relationshipWriteDecision({
        userId: "u", sourceType: "self", sourceId: null,
        targetType: "self", targetId: null, label: "friend",
      }),
    ).toEqual({ ok: false, reason: "self_relationship" });
  });

  it("gives mirrored edges the same pair key", () => {
    const a = relationshipWriteDecision({
      userId: "u", sourceType: "self", sourceId: null,
      targetType: "contact", targetId: "x", label: "wife",
    });
    const b = relationshipWriteDecision({
      userId: "u", sourceType: "contact", sourceId: "x",
      targetType: "self", targetId: null, label: "husband",
    });
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) expect(a.pairKey).toBe(b.pairKey);
  });

  it("keeps two different partners as two distinct edges", () => {
    const one = relationshipWriteDecision({
      userId: "u", sourceType: "self", sourceId: null,
      targetType: "contact", targetId: "xihui", label: "partner",
    });
    const two = relationshipWriteDecision({
      userId: "u", sourceType: "self", sourceId: null,
      targetType: "contact", targetId: "yumei", label: "partner",
    });
    expect(one.ok && two.ok).toBe(true);
    if (one.ok && two.ok) expect(one.pairKey).not.toBe(two.pairKey);
  });
});

describe("profile fact gate", () => {
  it("rejects label-echo and placeholder values", () => {
    expect(profileValueDecision("basics", "Gym", "Gym").ok).toBe(false);
    expect(profileValueDecision("basics", "City", "unknown").ok).toBe(false);
    expect(profileValueDecision("basics", "City", "").ok).toBe(false);
    expect(profileValueDecision("basics", "City", "B").ok).toBe(false);
  });

  it("accepts a real fact", () => {
    const d = profileValueDecision("basics", "City", "Berlin");
    expect(d.ok).toBe(true);
    if (d.ok) expect(d.value).toBe("Berlin");
  });
});
