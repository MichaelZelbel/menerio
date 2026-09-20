import { describe, it, expect } from "vitest";
import * as twin from "@/lib/hub-ranking";
import * as edge from "../../../supabase/functions/_shared/hub-ranking";
import { HUB_SOURCE_APP, isHubMirror } from "../../../supabase/functions/_shared/hub-source";
import { extractSearchTerms, isTitleHit, rankNotesByTerms } from "@/lib/search-terms";

describe("the frontend twin of the hub ranking policy", () => {
  it("carries the same numbers as the edge-function copy", () => {
    expect(twin.HUB_SOURCE_APP).toBe(HUB_SOURCE_APP);
    expect(twin.HUB_SIMILARITY_FACTOR).toBe(edge.HUB_SIMILARITY_FACTOR);
  });

  it("recognises a hub file exactly the way the edge functions do", () => {
    for (const v of [undefined, null, "", "web", "hub", " HUB ", "Hub", "hub-api", "obsidian"]) {
      expect(twin.isHubMirror(v)).toBe(isHubMirror(v));
    }
  });

  it("discounts the same way", () => {
    expect(twin.rankingScore(100, "hub")).toBe(edge.rankingSimilarity(100, "hub"));
    expect(twin.rankingScore(100, "web")).toBe(edge.rankingSimilarity(100, "web"));
    expect(twin.compareNativeFirst("hub", null)).toBe(edge.compareNativeFirst("hub", null));
    expect(twin.compareNativeFirst(null, "hub")).toBe(edge.compareNativeFirst(null, "hub"));
  });
});

describe("rankNotesByTerms with mirrored hub files", () => {
  const rank = (notes: Parameters<typeof rankNotesByTerms>[0], q: string) =>
    rankNotesByTerms(notes, q.toLowerCase(), extractSearchTerms(q));

  it("puts the native note first when both match identically", () => {
    const notes = [
      { id: "h", title: "Morning brief", content: "", updated_at: "2026-09-20", source_app: "hub" },
      { id: "n", title: "Morning brief", content: "", updated_at: "2026-01-01", source_app: "web" },
    ];
    expect(rank(notes, "morning brief").map((n) => (n as { id: string }).id)).toEqual(["n", "h"]);
  });

  it("lets a native prefix match pass a hub file whose title is merely longer", () => {
    const notes = [
      { id: "h", title: "Ownward Studio", content: "", updated_at: "2026-09-20", source_app: " HUB " },
      { id: "n", title: "Ownward Studio plan", content: "", updated_at: "2026-01-01", source_app: null },
    ];
    expect(rank(notes, "ownward studio").map((n) => (n as { id: string }).id)).toEqual(["n", "h"]);
  });

  it("demotes, never hides: a hub title match still beats a native body mention", () => {
    const notes = [
      { id: "n", title: "Journal", content: "talked about the morning brief today", updated_at: "2026-09-20", source_app: "web" },
      { id: "h", title: "Morning brief", content: "", updated_at: "2026-01-01", source_app: "hub" },
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
    const hub = { title: "Morning brief", content: "", source_app: "hub" };
    expect(isTitleHit(hub, "morning brief", ["morning", "brief"])).toBe(true);
  });
});
