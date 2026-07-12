import { describe, it, expect } from "vitest";
import { buildTitleMap, resolveWikilinksInHtml } from "../wikilink-resolver";

describe("resolveWikilinksInHtml — persisted-cache regression", () => {
  // The app-wide IndexedDB query persister JSON-serializes all query data.
  // A queryFn that returns a Map gets stored as "{}" and restored as a plain
  // object — truthy, but without .get(). This crashed every cold boot into a
  // note containing [[wikilinks]] ("r.get is not a function").
  it("degrades gracefully when handed a JSON-round-tripped (non-Map) title map", () => {
    const roundTripped = JSON.parse(JSON.stringify(new Map([["target", "id-1"]])));
    const html = "<p>See [[Target]] for details</p>";
    expect(() => resolveWikilinksInHtml(html, roundTripped)).not.toThrow();
    expect(resolveWikilinksInHtml(html, roundTripped)).toBe(html);
  });

  it("resolves wikilinks with a real Map built from note rows", () => {
    const map = buildTitleMap([
      { id: "id-1", title: "Target" },
      { id: "id-2", title: null },
    ]);
    const out = resolveWikilinksInHtml("<p>See [[Target]]</p>", map);
    expect(out).toContain('data-note-id="id-1"');
    expect(out).toContain('data-wikilink="true"');
  });

  it("note rows survive a JSON round-trip and still build a working Map", () => {
    const rows = [{ id: "id-1", title: "Target" }];
    const restored = JSON.parse(JSON.stringify(rows));
    const map = buildTitleMap(restored);
    expect(map.get("target")).toBe("id-1");
  });
});
