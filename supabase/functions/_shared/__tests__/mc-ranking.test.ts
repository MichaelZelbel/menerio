import { describe, it, expect } from "vitest";
import {
  GODSPEED_SIMILARITY_FACTOR,
  compareNativeFirst,
  demoteTier,
  godspeedFileLabel,
  hybridMatchTier,
  isGodspeedFolderPath,
  matchesSourceFilter,
  rankHybridRows,
  rankingSimilarity,
} from "../mc-ranking";
import { isGodspeedMirror } from "../mc-source";

describe("isGodspeedMirror", () => {
  it("is the same test that keeps mission control files away from fact extraction", () => {
    expect(isGodspeedMirror("godspeed")).toBe(true);
    expect(isGodspeedMirror(" GODSPEED ")).toBe(true);
    expect(isGodspeedMirror("mc-api")).toBe(false);
    expect(isGodspeedMirror(null)).toBe(false);
    expect(isGodspeedMirror(undefined)).toBe(false);
  });
});

describe("rankingSimilarity", () => {
  it("discounts a mission control file and leaves a native note alone", () => {
    expect(rankingSimilarity(0.8, "godspeed")).toBeCloseTo(0.8 * GODSPEED_SIMILARITY_FACTOR);
    expect(rankingSimilarity(0.8, "web")).toBe(0.8);
    expect(rankingSimilarity(0.8, null)).toBe(0.8);
  });

  it("keeps 'no similarity' as null so a text-only hit is not mistaken for a zero", () => {
    expect(rankingSimilarity(null, "godspeed")).toBeNull();
    expect(rankingSimilarity(undefined, "web")).toBeNull();
    expect(rankingSimilarity(Number.NaN, "web")).toBeNull();
  });
});

describe("demoteTier and compareNativeFirst", () => {
  it("drops a mission control file exactly one tier", () => {
    expect(demoteTier(0, "godspeed")).toBe(1);
    expect(demoteTier(5, "Godspeed")).toBe(6);
    expect(demoteTier(3, "mcp")).toBe(3);
  });

  it("sorts native before godspeed and has no opinion otherwise", () => {
    expect(compareNativeFirst("web", "godspeed")).toBeLessThan(0);
    expect(compareNativeFirst("godspeed", "web")).toBeGreaterThan(0);
    expect(compareNativeFirst("godspeed", "godspeed")).toBe(0);
    expect(compareNativeFirst(null, "telegram")).toBe(0);
  });
});

describe("matchesSourceFilter", () => {
  it("lets everything through by default", () => {
    expect(matchesSourceFilter("godspeed", "all")).toBe(true);
    expect(matchesSourceFilter("web", undefined)).toBe(true);
  });
  it("splits native from godspeed", () => {
    expect(matchesSourceFilter("godspeed", "native")).toBe(false);
    expect(matchesSourceFilter(null, "native")).toBe(true);
    expect(matchesSourceFilter("godspeed", "godspeed")).toBe(true);
    expect(matchesSourceFilter("obsidian", "godspeed")).toBe(false);
  });
});

describe("isGodspeedFolderPath", () => {
  it("claims the mirror's root and everything under it, whatever the case", () => {
    expect(isGodspeedFolderPath("godspeed")).toBe(true);
    expect(isGodspeedFolderPath("godspeed/rules")).toBe(true);
    expect(isGodspeedFolderPath("Godspeed/observations/x")).toBe(true);
  });
  it("does not claim a folder that merely starts with the same letters", () => {
    expect(isGodspeedFolderPath("hubris")).toBe(false);
    expect(isGodspeedFolderPath("projects/godspeed")).toBe(false);
    expect(isGodspeedFolderPath("")).toBe(false);
    expect(isGodspeedFolderPath(null)).toBe(false);
  });
});

describe("godspeedFileLabel", () => {
  it("names the mirrored file so a model can tell it from a written note", () => {
    expect(godspeedFileLabel("godspeed", "rules/verify-before-asserting.md")).toBe("[godspeed file: rules/verify-before-asserting.md]");
    expect(godspeedFileLabel("godspeed", null)).toBe("[godspeed file]");
  });
  it("says nothing about a native note", () => {
    expect(godspeedFileLabel("web", "anything")).toBeNull();
    expect(godspeedFileLabel(null, null)).toBeNull();
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

  it("demotes a mission control file one tier: an exact mission control title lands among native prefix titles", () => {
    const rows = [
      { id: "mc-exact", title: "Berlin", source_app: "godspeed", similarity: 0.9 },
      { id: "native-contains", title: "My Berlin trip", source_app: "web", similarity: 0.5 },
      { id: "native-prefix", title: "Berlin trip", source_app: "web", similarity: 0.3 },
    ];
    // mc-exact earned tier 0 and sorts in tier 1. Inside tier 1 its discounted
    // similarity (0.9 * 0.85) still beats the native prefix title's 0.3.
    expect(ids(rankHybridRows(rows, "berlin"))).toEqual(["mc-exact", "native-prefix", "native-contains"]);
  });

  it("inside a tier the discounted similarity decides, and native wins only a tie", () => {
    const rows = [
      { id: "godspeed", title: "a", source_app: "godspeed", similarity: 0.95 },          // tier 4 -> 5
      { id: "native-text", title: "b", source_app: "web", similarity: null },  // tier 5
    ];
    // A mission control file that matches by meaning is not hidden behind a bare text hit.
    expect(ids(rankHybridRows(rows, "zzz"))).toEqual(["godspeed", "native-text"]);

    const tie = [
      { id: "godspeed", title: "a", source_app: "godspeed", similarity: 0.8 },            // 0.8 * 0.85 = 0.68, tier 5
      { id: "native", title: "b", source_app: "web", similarity: 0.68 },       // tier 4
    ];
    expect(ids(rankHybridRows(tie, "zzz"))).toEqual(["native", "godspeed"]);
  });

  it("orders natives by similarity and godspeed files by similarity, separately", () => {
    const rows = [
      { id: "h1", title: "a", source_app: "godspeed", similarity: 0.5 },
      { id: "n1", title: "b", source_app: null, similarity: 0.4 },
      { id: "h2", title: "c", source_app: "godspeed", similarity: 0.7 },
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
