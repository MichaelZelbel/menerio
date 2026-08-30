import { describe, it, expect } from "vitest";
import { editorShowsContent } from "@/components/notes/NoteEditor";

/** Minimal stand-in for the Tiptap editor surface the check uses. */
function fakeEditor(markdown: string) {
  return {
    // The real editor round-trips through Tiptap JSON; the helper only needs
    // the resulting markdown, so we hand it over directly.
    getJSON: () => markdown,
    getText: () =>
      markdown
        .replace(/\[([^\]]*)\]\(([^)]*)\)/g, "$1 $2")
        .replace(/[`*_>#~|-]/g, " ")
        .replace(/\s+/g, " ")
        .trim(),
  };
}

describe("editorShowsContent", () => {
  it("accepts content with bare URLs (the autolink false-failure case)", () => {
    const md = "https://artificialanalysis.ai/leaderboards/models\n\nSome text.";
    expect(editorShowsContent(fakeEditor(md) as never, md)).toBe(true);
  });

  it("accepts trailing-whitespace and CRLF differences", () => {
    expect(editorShowsContent(fakeEditor("Hello world") as never, "Hello world\r\n\n")).toBe(
      true,
    );
  });

  it("still rejects genuinely different content", () => {
    expect(editorShowsContent(fakeEditor("Old text") as never, "Brand new text")).toBe(false);
  });

  it("treats an empty editor as showing empty content", () => {
    expect(editorShowsContent(fakeEditor("") as never, "")).toBe(true);
  });
});

