import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  canonicalLabel,
  describeRelationship,
  displayRole,
  genderFromFacts,
  relationshipPairKey,
} from "@/lib/relationship-canonical";

function sharedCore(path: string): string {
  const text = readFileSync(resolve(process.cwd(), path), "utf8");
  const start = text.indexOf("// --- BEGIN SHARED CORE ---");
  const end = text.indexOf("// --- END SHARED CORE ---");
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return text.slice(start, end);
}

describe("relationship canonical mirror", () => {
  it("frontend and edge copies share a byte-identical core", () => {
    expect(sharedCore("src/lib/relationship-canonical.ts")).toBe(
      sharedCore("supabase/functions/_shared/relationship-canonical.ts"),
    );
  });
});

describe("canonicalLabel", () => {
  it("folds free-text romantic variants into one label", () => {
    for (const raw of [
      "romantic partner", "Intimate Partner", "sexual partner", "romantic interest",
      "companion", "partner (companion)", "girlfriend", "boyfriend", "fiancée",
    ]) {
      expect(canonicalLabel(raw)).toBe("partner");
    }
  });

  it("folds social/work variants", () => {
    expect(canonicalLabel("friend/colleague")).toBe("friend");
    expect(canonicalLabel("friend or colleague")).toBe("friend");
    expect(canonicalLabel("acquaintance")).toBe("friend");
    expect(canonicalLabel("team member")).toBe("co-worker");
    expect(canonicalLabel("collaborator")).toBe("co-worker");
    expect(canonicalLabel("manager or coordinator")).toBe("manager");
  });

  it("lowercases and trims unknown labels so they cannot duplicate themselves", () => {
    expect(canonicalLabel("  Dog Walker.  ")).toBe("dog walker");
  });

  it("keeps marriage variants on one pair key", () => {
    const a = { type: "self" as const, id: null };
    const b = { type: "contact" as const, id: "x" };
    const k = relationshipPairKey("u", a, b, "spouse");
    expect(relationshipPairKey("u", a, b, "wife")).toBe(k);
    expect(relationshipPairKey("u", b, a, "husband")).toBe(k);
  });
});

describe("describeRelationship", () => {
  const edge = {
    sourceType: "self",
    sourceId: null,
    targetType: "contact",
    targetId: "xihui",
    label: "spouse",
    sourceName: "Michael",
    targetName: "Xihui",
  };

  it("names the OTHER person's role when viewing the contact", () => {
    const r = describeRelationship({ ...edge, viewingContactId: "xihui", otherGender: "male" });
    expect(r.display).toBe("Husband: Michael");
  });

  it("inverts correctly when viewing the owner", () => {
    const r = describeRelationship({ ...edge, viewingContactId: null, otherGender: "female" });
    expect(r.display).toBe("Wife: Xihui");
  });

  it("genders partner as boyfriend/girlfriend", () => {
    const r = describeRelationship({
      ...edge, label: "girlfriend", targetId: "yumei", targetName: "Yumei",
      viewingContactId: "yumei", otherGender: "male",
    });
    expect(r.display).toBe("Boyfriend: Michael");
  });

  it("falls back to the neutral role without a known gender", () => {
    const r = describeRelationship({ ...edge, viewingContactId: "xihui" });
    expect(r.display).toBe("Spouse: Michael");
  });

  it("inverts asymmetric roles", () => {
    const r = describeRelationship({
      sourceType: "self", sourceId: null, targetType: "contact", targetId: "c",
      label: "employer", sourceName: "Michael", targetName: "Ann",
      viewingContactId: "c",
    });
    expect(r.display).toBe("Employer: Michael");
    const back = describeRelationship({
      sourceType: "self", sourceId: null, targetType: "contact", targetId: "c",
      label: "employer", sourceName: "Michael", targetName: "Ann",
      viewingContactId: null,
    });
    expect(back.display).toBe("Employee: Ann");
  });

  it("keeps a custom label verbatim", () => {
    const r = describeRelationship({
      ...edge, customLabel: "cat sitter", viewingContactId: "xihui",
    });
    expect(r.display).toBe("Cat sitter: Michael");
  });
});

describe("gender resolution", () => {
  it("reads gender and pronoun facts, never names", () => {
    expect(genderFromFacts("Male")).toBe("male");
    expect(genderFromFacts("weiblich")).toBe("female");
    expect(genderFromFacts(null, "she/her")).toBe("female");
    expect(genderFromFacts(null, "they/them")).toBeNull();
    expect(genderFromFacts(null, null)).toBeNull();
  });

  it("respects already-gendered roles", () => {
    expect(displayRole("wife", null)).toBe("Wife");
    expect(displayRole("sibling", "female")).toBe("Sister");
    expect(displayRole("friend", "male")).toBe("Friend");
  });
});

describe("closed vocabulary and perspective collapse", () => {
  it("rejects non-relationships", () => {
    expect(relationshipKind("author")).toBe("other");
    expect(relationshipKind("platform")).toBe("other");
    expect(relationshipKind("financial advisor")).toBe("professional");
    expect(relationshipKind("stepfather")).toBe("personal");
  });

  it("collapses both stored directions of one bond onto one key", () => {
    const u = "u1";
    const me = { type: "self" as const, id: null };
    const j = { type: "contact" as const, id: "j" };
    expect(relationshipPairKey(u, j, me, "stepfather")).toBe(relationshipPairKey(u, me, j, "stepson"));
    expect(relationshipPairKey(u, j, me, "father")).toBe(relationshipPairKey(u, me, j, "son"));
  });

  it("renders the other person's role from the viewer's perspective, name cleaned", () => {
    const d = describeRelationship({
      sourceType: "self", sourceId: null,
      targetType: "contact", targetId: "j",
      label: "stepson", customLabel: null,
      viewingContactId: null,
      sourceName: "Me", targetName: "Jürgen Skoppek (Stiefvater)",
      otherGender: "male",
    });
    expect(d.display).toBe("Stepfather: Jürgen Skoppek");
  });
});
