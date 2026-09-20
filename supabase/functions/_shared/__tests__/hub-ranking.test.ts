import { describe, it, expect } from "vitest";
import {
  HUB_SIMILARITY_FACTOR,
  compareNativeFirst,
  demoteTier,
  hubFileLabel,
  hybridMatchTier,
  isHubFolderPath,
  matchesSourceFilter,
  rankHybridRows,
  rankingSimilarity,
} from "../hub-ranking";
import { isHubMirror } from "../hub-source";

describe("isHubMirror", () => {
  it("is the same test that keeps hub files away from fact extraction", () => {
    expect(isHubMirror("hub")).toBe(true);
    expect(isHubMirror(" HUB ")).toBe(true);
    expect(isHubMirror("hub-api")).toBe(false);
    expect(isHubMirror(null)).toBe(false);
    expect(isHubMirror(undefined)).toBe(false);
  });
});

describe("rankingSimilarity", () => {
  it("discounts a hub file and leaves a native note alone", () => {
    expect(rankingSimilarity(0.8, "hub")).toBeCloseTo(0.8 * HUB_SIMILARITY_FACTOR);
    expect(rankingSimilarity(0.8, "web")).toBe(0.8);
    expect(rankingSimilarity(0.8, null)).toBe(0.8);
  });

  it("keeps 'no similarity' as null so a text-only hit is not mistaken for a zero", () => {
    expect(rankingSimilarity(null, "hub")).toBeNull();
    expect(rankingSimilarity(undefined, "web")).toBeNull();
    expect(rankingSimilarity(Number.NaN, "web")).toBeNull();
  });
});

describe("demoteTier and compareNativeFirst", () => {
  it("drops a hub file exactly one tier", () => {
    expect(demoteTier(0, "hub")).toBe(1);
    expect(demoteTier(5, "Hub")).toBe(6);
    expect(demoteTier(3, "mcp")).toBe(3);
  });

  it("sorts native before hub and has no opinion otherwise", () => {
    expect(compareNativeFirst("web", "hub")).toBeLessThan(0);
    expect(compareNativeFirst("hub", "web")).toBeGreaterThan(0);
    expect(compareNativeFirst("hub", "hub")).toBe(0);
    expect(compareNativeFirst(null, "telegram")).toBe(0);
  });
});

describe("matchesSourceFilter", () => {
  it("lets everything through by default", () => {
    expect(matchesSourceFilter("hub", "all")).toBe(true);
    expect(matchesSourceFilter("web", undefined)).toBe(true);
  });
  it("splits native from hub", () => {
    expect(matchesSourceFilter("hub", "native")).toBe(false);
    expect(matchesSourceFilter(null, "native")).toBe(true);
    expect(matchesSourceFilter("hub", "hub")).toBe(true);
    expect(matchesSourceFilter("obsidian", "hub")).toBe(false);
  });
});

describe("isHubFolderPath", () => {
  it("claims the mirror's root and everything under it, whatever the case", () => {
    expect(isHubFolderPath("hub")).toBe(true);
    expect(isHubFolderPath("hub/rules")).toBe(true);
    expect(isHubFolderPath("Hub/observations/x")).toBe(true);
  });
  it("does not claim a folder that merely starts with the same letters", () => {
    expect(isHubFolderPath("hubris")).toBe(false);
    expect(isHubFolderPath("projects/hub")).toBe(false);
    expect(isHubFolderPath("")).toBe(false);
    expect(isHubFolderPath(null)).toBe(false);
  });
});

describe("hubFileLabel", () => {
  it("names the mirrored file so a model can tell it from a written note", () => {
    expect(hubFileLabel("hub", "rules/verify-before-asserting.md")).toBe("[hub file: rules/verify-before-asserting.md]");
    expect(hubFileLabel("hub", null)).toBe("[hub file]");
  });
  it("says nothing about a native note", () => {
    expect(hubFileLabel("web", "anything")).toBeNull();
    expect(hubFileLabel(null, null)).toBeNull();
  });
});

describe("rankHybridRows", () => {
  const ids = (rows: { id: string }[]) => rows.map((r) => r.id);

  it("keeps the match tiers it took over from the MCP search", () => {
    expect(hybridMatchTier({ title: "Berlin" }, "berlin")).toBe(0);
    expect(hybridMatchTier({ title: "Berlin trip" }, "berlin")).toBe(1);
    expect(hybridMatchTier({ title: "My Berlin trip" }, "berlin")).toBe(2);
    expect(hybridMatchTier({ title: "x", exact_phrase_match: true }, "berlin")).toBe(3);
    expect(hybridMatchTier({ title: "x", similarity: 0.4 }, "berlin")).toBe(4);
    expect(hybridMatchTier({ title: "x", similarity: null }, "berlin")).toBe(5);
  });

  it("demotes a hub file one tier: an exact hub title lands among native prefix titles", () => {
    const rows = [
      { id: "hub-exact", title: "Berlin", source_app: "hub", similarity: 0.9 },
      { id: "native-contains", title: "My Berlin trip", source_app: "web", similarity: 0.5 },
      { id: "native-prefix", title: "Berlin trip", source_app: "web", similarity: 0.3 },
    ];
    // hub-exact earned tier 0, sorts in tier 1, and inside tier 1 native is first.
    expect(ids(rankHybridRows(rows, "berlin"))).toEqual(["native-prefix", "hub-exact", "native-contains"]);
  });

  it("puts native first inside a tier even when the hub file is more similar", () => {
    const rows = [
      { id: "hub", title: "a", source_app: "hub", similarity: 0.95 },          // tier 4 -> 5
      { id: "native-text", title: "b", source_app: "web", similarity: null },  // tier 5
    ];
    expect(ids(rankHybridRows(rows, "zzz"))).toEqual(["native-text", "hub"]);
  });

  it("orders natives by similarity and hub files by similarity, separately", () => {
    const rows = [
      { id: "h1", title: "a", source_app: "hub", similarity: 0.5 },
      { id: "n1", title: "b", source_app: null, similarity: 0.4 },
      { id: "h2", title: "c", source_app: "hub", similarity: 0.7 },
      { id: "n2", title: "d", source_app: "mcp", similarity: 0.6 },
    ];
    expect(ids(rankHybridRows(rows, "zzz"))).toEqual(["n2", "n1", "h2", "h1"]);
  });

  it("breaks a full tie by recency, then by arrival order", () => {
    const rows = [
      { id: "old", title: "a", similarity: 0.5, updated_at: "2026-01-01T00:00:00Z" },
      { id: "new", title: "b", similarity: 0.5, updated_at: "2026-09-01T00:00:00Z" },
      { id: "same-1", title: "c", similarity: 0.1 },
      { id: "same-2", title: "d", similarity: 0.1 },
    ];
    expect(ids(rankHybridRows(rows, "zzz"))).toEqual(["new", "old", "same-1", "same-2"]);
  });
});
