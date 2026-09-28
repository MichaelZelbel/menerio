import { describe, expect, it } from "vitest";
import { attributeForLabel, buildFactLabelMap } from "../fact-label-map.ts";

describe("buildFactLabelMap", () => {
  it("keys entry labels by normalizeAttribute, as the bridge did", () => {
    expect(attributeForLabel("  Favourite  food ")).toBe("favourite-food");
  });

  it("files reserved relationship labels under relationship-note, keeping the words", () => {
    const [row] = buildFactLabelMap(["Relationship"], []);
    expect(row).toMatchObject({ kind: "label", attribute: "relationship-note", label: "Relationship" });
  });

  it("never returns an empty attribute", () => {
    expect(attributeForLabel("   ")).toBe("note");
  });

  it("keeps a claim's own attribute and places it like placeClaim", () => {
    const [row] = buildFactLabelMap([], ["city"]);
    expect(row).toMatchObject({ kind: "attribute", key: "city", attribute: "city", label: "Current city", category_slug: "location" });
  });

  it("one row per distinct label and attribute", () => {
    expect(buildFactLabelMap(["A", "A", "B"], ["x", "x"])).toHaveLength(3);
  });
});
