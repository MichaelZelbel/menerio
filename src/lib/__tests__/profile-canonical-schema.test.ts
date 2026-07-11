import { describe, expect, it } from "vitest";
import {
  canonicalProfileLabel,
  isSingleValueLabel,
  matchProfileCategoryByLabel,
  normalizeProfileValueForDedup,
  stripTrailingQualifier,
} from "../../../supabase/functions/_shared/profile-canonical-schema";

describe("stripTrailingQualifier", () => {
  it("strips a trailing parenthetical qualifier", () => {
    expect(stripTrailingQualifier(`5'4" (fun sized)`)).toBe(`5'4"`);
    expect(stripTrailingQualifier("Notion (acquired)")).toBe("Notion");
  });

  it("keeps values without a trailing qualifier unchanged", () => {
    expect(stripTrailingQualifier(`5'4"`)).toBe(`5'4"`);
    expect(stripTrailingQualifier("Berlin")).toBe("Berlin");
  });

  it("does not strip when the whole value is parenthetical", () => {
    expect(stripTrailingQualifier("(unknown)")).toBe("(unknown)");
  });

  it("does not strip a mid-value parenthetical", () => {
    expect(stripTrailingQualifier("John (JJ) Smith")).toBe("John (JJ) Smith");
  });
});

describe("normalizeProfileValueForDedup", () => {
  it("makes qualifier-only variants compare equal", () => {
    expect(normalizeProfileValueForDedup(`5'4" (fun sized)`)).toBe(
      normalizeProfileValueForDedup(`5'4"`),
    );
  });

  it("collapses whitespace and lowercases", () => {
    expect(normalizeProfileValueForDedup("  Head of   Design ")).toBe("head of design");
  });

  it("keeps genuinely different values distinct", () => {
    expect(normalizeProfileValueForDedup(`5'4"`)).not.toBe(normalizeProfileValueForDedup(`5'6"`));
  });
});

describe("canonical schema: physical identity attributes", () => {
  it("treats Height as a single-value identity label", () => {
    expect(canonicalProfileLabel("identity", "height")).toBe("Height");
    expect(isSingleValueLabel("Height")).toBe(true);
  });

  it("maps 'also known as' onto the Nickname label", () => {
    expect(canonicalProfileLabel("identity", "Also known as")).toBe("Nickname");
  });

  it("canonicalizes Height even when extracted into an open category", () => {
    expect(canonicalProfileLabel("preferences", "Height")).toBe("Height");
  });
});

describe("matchProfileCategoryByLabel", () => {
  it("matches a canonical structured label to its category", () => {
    expect(matchProfileCategoryByLabel("Hair color")).toEqual({
      slug: "identity",
      canonicalLabel: "Hair color",
    });
  });

  it("matches a case/whitespace-insensitive alias to its canonical home", () => {
    expect(matchProfileCategoryByLabel("  EMAIL ")).toEqual({
      slug: "communication",
      canonicalLabel: "Email",
    });
    expect(matchProfileCategoryByLabel("birthday")).toEqual({
      slug: "identity",
      canonicalLabel: "Date of birth",
    });
  });

  it("routes re-homed labels to their true category (not identity)", () => {
    expect(matchProfileCategoryByLabel("wedding date")).toEqual({
      slug: "relationships",
      canonicalLabel: "Wedding date",
    });
    expect(matchProfileCategoryByLabel("place of birth")).toEqual({
      slug: "identity",
      canonicalLabel: "Place of birth",
    });
  });

  it("returns null for unknown labels (defer to the LLM)", () => {
    expect(matchProfileCategoryByLabel("favorite hair color")).toBeNull();
    expect(matchProfileCategoryByLabel("loves hotpot")).toBeNull();
  });

  it("returns null for an empty/whitespace label", () => {
    expect(matchProfileCategoryByLabel("")).toBeNull();
    expect(matchProfileCategoryByLabel("   ")).toBeNull();
  });

  it("never resolves to an open category (those always defer to the LLM)", () => {
    // "hotpot" and other open-category topics have no structured label, so the
    // matcher must return null rather than guessing an open slug.
    expect(matchProfileCategoryByLabel("hotpot")).toBeNull();
  });
});
