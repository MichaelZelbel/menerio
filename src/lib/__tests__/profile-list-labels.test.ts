import { describe, expect, it } from "vitest";
import {
  isCharacterLabel,
  isListValuedLabel,
  splitListValue,
  titleCaseCharacterName,
} from "../profile-list-labels";

describe("isListValuedLabel", () => {
  it("recognizes plural favorite-* labels", () => {
    expect(isListValuedLabel("Favorite restaurants")).toBe(true);
    expect(isListValuedLabel("Favorite characters")).toBe(true);
    expect(isListValuedLabel("Favorite songs")).toBe(true);
    expect(isListValuedLabel("favorite foods")).toBe(true);
  });
  it("does not treat single-valued labels as lists", () => {
    expect(isListValuedLabel("Current city")).toBe(false);
    expect(isListValuedLabel("Go-to recipe")).toBe(false);
    expect(isListValuedLabel("Favorite McDonald's order")).toBe(false);
  });
});

describe("splitListValue", () => {
  it("splits, trims, and drops empties", () => {
    expect(splitListValue(" a, b ,, c , ")).toEqual(["a", "b", "c"]);
  });
});

describe("titleCaseCharacterName", () => {
  it("capitalizes plain lowercase names", () => {
    expect(titleCaseCharacterName("geum seong je")).toBe("Geum Seong Je");
  });
  it("leaves tokens with any uppercase letter untouched", () => {
    expect(titleCaseCharacterName("d3R")).toBe("d3R");
    expect(titleCaseCharacterName("McDonalds")).toBe("McDonalds");
  });
  it("handles empty input", () => {
    expect(titleCaseCharacterName("")).toBe("");
  });
});

describe("isCharacterLabel", () => {
  it("matches case-insensitively", () => {
    expect(isCharacterLabel("Favorite characters")).toBe(true);
    expect(isCharacterLabel("favorite characters")).toBe(true);
    expect(isCharacterLabel("Favorite character")).toBe(false);
  });
});
