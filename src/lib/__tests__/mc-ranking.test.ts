import { describe, it, expect } from "vitest";
import * as twin from "@/lib/mc-ranking";
import * as edge from "../../../supabase/functions/_shared/mc-ranking";
import { GODSPEED_SOURCE_APP, isGodspeedMirror } from "../../../supabase/functions/_shared/mc-source";
import { extractSearchTerms, isTitleHit, rankNotesByTerms } from "@/lib/search-terms";

describe("the frontend twin of Mission Control ranking policy", () => {
  it("carries the same numbers as the edge-function copy", () => {
    expect(twin.GODSPEED_SOURCE_APP).toBe(GODSPEED_SOURCE_APP);
    expect(twin.GODSPEED_SIMILARITY_FACTOR).toBe(edge.GODSPEED_SIMILARITY_FACTOR);
  });

  it("recognises a mission control file exactly the way the edge functions do", () => {
    for (const v of [undefined, null, "", "web", "godspeed", " GODSPEED ", "Godspeed", "mc-api", "obsidian"]) {
      expect(twin.isGodspeedMirror(v)).toBe(isGodspeedMirror(v));
    }
  });

  it("discounts the same way", () => {
    expect(twin.rankingScore(100, "godspeed")).toBe(edge.rankingSimilarity(100, "godspeed"));
    expect(twin.rankingScore(100, "web")).toBe(edge.rankingSimilarity(100, "web"));
    expect(twin.compareNativeFirst("godspeed", null)).toBe(edge.compareNativeFirst("godspeed", null));
    expect(twin.compareNativeFirst(null, "godspeed")).toBe(edge.compareNativeFirst(null, "godspeed"));
  });
});

describe("rankNotesByTerms with mirrored godspeed files", () => {
  const rank = (notes: Parameters<typeof rankNotesByTerms>[0], q: string) =>
    rankNotesByTerms(notes, q.toLowerCase(), extractSearchTerms(q));

  it("puts the native note first when both match identically", () => {
    const notes = [
      { id: "h", title: "Morning brief", content: "", updated_at: "2026-09-20", source_app: "godspeed" },
      { id: "n", title: "Morning brief", content: "", updated_at: "2026-01-01", source_app: "web" },
    ];
    expect(rank(notes, "morning brief").map((n) => (n as { id: string }).id)).toEqual(["n", "h"]);
  });

  it("lets a native prefix match pass a mission control file whose title is merely longer", () => {
    const notes = [
      { id: "h", title: "Ownward Studio", content: "", updated_at: "2026-09-20", source_app: " GODSPEED " },
      { id: "n", title: "Ownward Studio plan", content: "", updated_at: "2026-01-01", source_app: null },
    ];
    expect(rank(notes, "ownward studio").map((n) => (n as { id: string }).id)).toEqual(["n", "h"]);
  });

  it("demotes, never hides: a mission control title match still beats a native body mention", () => {
    const notes = [
      { id: "n", title: "Journal", content: "talked about the morning brief today", updated_at: "2026-09-20", source_app: "web" },
      { id: "h", title: "Morning brief", content: "", updated_at: "2026-01-01", source_app: "godspeed" },
    ];
    expect(rank(notes, "morning brief").map((n) => (n as { id: string }).id)).toEqual(["h", "n"]);
  });

  it("changes nothing for rows that do not carry source_app", () => {
    const notes = [
      { id: "a", title: "Morning brief", content: "", updated_at: "2026-09-20" },
      { id: "b", title: "Morning brief", content: "", updated_at: "2026-01-01" },
    ];
    expect(rank(notes, "morning brief").map((n) => (n as { id: string }).id)).toEqual(["a", "b"]);
  });

  it("leaves 'did the title match' a fact about the match, not the source", () => {
    const godspeed = { title: "Morning brief", content: "", source_app: "godspeed" };
    expect(isTitleHit(godspeed, "morning brief", ["morning", "brief"])).toBe(true);
  });
});
