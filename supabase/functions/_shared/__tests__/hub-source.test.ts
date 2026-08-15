import { describe, it, expect } from "vitest";
import { shouldExtractFacts, HUB_SOURCE_APP } from "../hub-source";

describe("shouldExtractFacts", () => {
  it("extracts from a note the user wrote in the app", () => {
    expect(shouldExtractFacts(undefined)).toBe(true);
    expect(shouldExtractFacts(null)).toBe(true);
    expect(shouldExtractFacts("web")).toBe(true);
  });

  it("never extracts from a file synced out of the hub", () => {
    expect(shouldExtractFacts(HUB_SOURCE_APP)).toBe(false);
    expect(shouldExtractFacts("hub")).toBe(false);
  });

  it("ignores case and surrounding space, because the sender is another program", () => {
    expect(shouldExtractFacts(" HUB ")).toBe(false);
    expect(shouldExtractFacts("Hub")).toBe(false);
  });

  it("still extracts from the older hub-api sender, which was user capture", () => {
    expect(shouldExtractFacts("hub-api")).toBe(true);
  });

  it("treats an empty string as an ordinary note", () => {
    expect(shouldExtractFacts("")).toBe(true);
  });
});
