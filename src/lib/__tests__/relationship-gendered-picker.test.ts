import { describe, expect, it } from "vitest";
import {
  ALL_RELATIONSHIP_LABELS,
  getInverseLabel,
  impliedGenderFromLabel,
} from "@/lib/relationship-labels";
import { displayRole } from "@/lib/relationship-canonical";

describe("gendered relationship picker", () => {
  it("offers gendered wordings in the picker", () => {
    for (const l of ["girlfriend", "boyfriend", "wife", "husband", "mother", "father"]) {
      expect(ALL_RELATIONSHIP_LABELS).toContain(l);
    }
  });

  it("maps gendered picks to a gender fact", () => {
    expect(impliedGenderFromLabel("girlfriend")).toBe("female");
    expect(impliedGenderFromLabel("boyfriend")).toBe("male");
    expect(impliedGenderFromLabel("partner")).toBeNull();
  });

  it("renders 'Girlfriend' once the gender fact exists", () => {
    // Storage collapses girlfriend → partner; the gender fact restores wording.
    expect(displayRole(getInverseLabel("girlfriend"), "female")).toBe("Girlfriend");
    expect(displayRole(getInverseLabel("girlfriend"), null)).toBe("Partner");
  });
});
