import { describe, expect, it } from "vitest";
import { filterEntries, highlightSegments } from "../profile-field-filter";

const entries = [
  { id: "1", label: "Current city", value: "Berlin" },
  { id: "2", label: "Favorite food", value: "Ramen" },
  { id: "3", label: "Berlin trip", value: "Loved the museums" },
];

describe("filterEntries", () => {
  it("returns every entry when the query is empty", () => {
    const result = filterEntries(entries, "");
    expect(result.size).toBe(entries.length);
    for (const entry of entries) expect(result.has(entry.id)).toBe(true);
  });

  it("returns every entry when the query is whitespace only", () => {
    const result = filterEntries(entries, "   ");
    expect(result.size).toBe(entries.length);
  });

  it("matches case-insensitively", () => {
    const result = filterEntries(entries, "BERLIN");
    expect(result.has("1")).toBe(true);
    expect(result.has("3")).toBe(true);
    expect(result.has("2")).toBe(false);
  });

  it("distinguishes label matches from value matches", () => {
    const result = filterEntries(entries, "berlin");
    expect(result.get("1")).toEqual({ matchedLabel: false, matchedValue: true });
    expect(result.get("3")).toEqual({ matchedLabel: true, matchedValue: false });
  });

  it("flags both matchedLabel and matchedValue when the query appears in both", () => {
    const both = [{ id: "4", label: "Ramen shop", value: "Ramen Ichiraku" }];
    const result = filterEntries(both, "ramen");
    expect(result.get("4")).toEqual({ matchedLabel: true, matchedValue: true });
  });

  it("excludes entries with no match in label or value", () => {
    const result = filterEntries(entries, "xyz-nomatch");
    expect(result.size).toBe(0);
  });
});

describe("highlightSegments", () => {
  it("returns a single unmatched segment for an empty query", () => {
    expect(highlightSegments("Berlin", "")).toEqual([{ text: "Berlin", matched: false }]);
  });

  it("returns a single unmatched segment when there is no match", () => {
    expect(highlightSegments("Berlin", "xyz")).toEqual([{ text: "Berlin", matched: false }]);
  });

  it("splits around a single case-insensitive match", () => {
    expect(highlightSegments("Berlin trip", "berlin")).toEqual([
      { text: "Berlin", matched: true },
      { text: " trip", matched: false },
    ]);
  });

  it("splits around multiple occurrences of the query", () => {
    expect(highlightSegments("ramen shop sells ramen", "ramen")).toEqual([
      { text: "ramen", matched: true },
      { text: " shop sells ", matched: false },
      { text: "ramen", matched: true },
    ]);
  });

  it("matches a substring in the middle of a word", () => {
    expect(highlightSegments("Strawberry", "raw")).toEqual([
      { text: "St", matched: false },
      { text: "raw", matched: true },
      { text: "berry", matched: false },
    ]);
  });
});
