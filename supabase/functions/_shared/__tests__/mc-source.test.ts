import { describe, it, expect } from "vitest";
import { shouldExtractFacts, GODSPEED_SOURCE_APP } from "../mc-source";

describe("shouldExtractFacts", () => {
  it("extracts from a note the user wrote in the app", () => {
    expect(shouldExtractFacts(undefined)).toBe(true);
    expect(shouldExtractFacts(null)).toBe(true);
    expect(shouldExtractFacts("web")).toBe(true);
  });

  it("never extracts from a file synced out of Mission Control", () => {
    expect(shouldExtractFacts(GODSPEED_SOURCE_APP)).toBe(false);
    expect(shouldExtractFacts("godspeed")).toBe(false);
  });

  it("ignores case and surrounding space, because the sender is another program", () => {
    expect(shouldExtractFacts(" GODSPEED ")).toBe(false);
    expect(shouldExtractFacts("Godspeed")).toBe(false);
  });

  it("still extracts from the older mc-api sender, which was user capture", () => {
    expect(shouldExtractFacts("mc-api")).toBe(true);
  });

  it("treats an empty string as an ordinary note", () => {
    expect(shouldExtractFacts("")).toBe(true);
  });
});
