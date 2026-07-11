import { describe, expect, it } from "vitest";
import {
  PROFILE_TAXONOMY,
  taxonomyBySlug,
  taxonomyOrder,
  compareCategoriesForDisplay,
} from "../profile-taxonomy";

const EXPECTED_SLUGS = [
  "identity",
  "location",
  "professional",
  "education",
  "relationships",
  "communication",
  "personality",
  "principles",
  "health",
  "hobbies",
  "food",
  "entertainment",
  "travel",
  "digital",
  "financial",
  "goals",
  "preferences",
];

describe("PROFILE_TAXONOMY", () => {
  it("has exactly the 17 canonical slugs", () => {
    expect(PROFILE_TAXONOMY).toHaveLength(17);
    expect(PROFILE_TAXONOMY.map((t) => t.slug).sort()).toEqual([...EXPECTED_SLUGS].sort());
  });

  it("every entry has a slug, name, and icon", () => {
    for (const entry of PROFILE_TAXONOMY) {
      expect(entry.slug).toBeTruthy();
      expect(entry.name).toBeTruthy();
      expect(entry.icon).toBeTruthy();
    }
  });

  it("exposes each taxonomy entry by slug via taxonomyBySlug", () => {
    for (const entry of PROFILE_TAXONOMY) {
      expect(taxonomyBySlug[entry.slug]).toEqual(entry);
    }
  });
});

describe("taxonomyOrder", () => {
  it("is stable and matches the declared taxonomy order", () => {
    PROFILE_TAXONOMY.forEach((entry, index) => {
      expect(taxonomyOrder(entry.slug)).toBe(index);
    });
  });

  it("sorts an unknown slug after every known slug", () => {
    const maxKnown = Math.max(...PROFILE_TAXONOMY.map((t) => taxonomyOrder(t.slug)));
    expect(taxonomyOrder("some-custom-slug")).toBeGreaterThan(maxKnown);
    expect(taxonomyOrder("")).toBeGreaterThan(maxKnown);
  });
});

describe("compareCategoriesForDisplay", () => {
  it("orders known slugs by taxonomy order regardless of name", () => {
    const a = { slug: "preferences", name: "Zzz Preferences" };
    const b = { slug: "identity", name: "Aaa Identity" };
    expect(compareCategoriesForDisplay(a, b)).toBeGreaterThan(0);
    expect(compareCategoriesForDisplay(b, a)).toBeLessThan(0);
  });

  it("sorts unknown slugs after all known slugs", () => {
    const known = { slug: "identity", name: "Identity & Basics" };
    const custom = { slug: "my-custom-cat", name: "Aaa Custom" };
    expect(compareCategoriesForDisplay(custom, known)).toBeGreaterThan(0);
    expect(compareCategoriesForDisplay(known, custom)).toBeLessThan(0);
  });

  it("sorts unknown-vs-unknown slugs alphabetically by name", () => {
    const a = { slug: "custom-a", name: "Banana Club" };
    const b = { slug: "custom-b", name: "Apple Club" };
    expect(compareCategoriesForDisplay(a, b)).toBeGreaterThan(0);
    expect(compareCategoriesForDisplay(b, a)).toBeLessThan(0);
  });
});
