import { describe, it, expect } from "vitest";
import {
  htmlToMarkdown,
  markdownToHtml,
  noteToMarkdown,
  markdownToNote,
  noteToFilePath,
  filePathToNoteTitle,
  internalLinksToWikilinks,
  wikilinksToInternalLinks,
  NoteForExport,
} from "../markdown-converter";

// ─── htmlToMarkdown ──────────────────────────────────────────────────

describe("htmlToMarkdown", () => {
  it("converts headings", () => {
    expect(htmlToMarkdown("<h1>Title</h1>")).toContain("# Title");
    expect(htmlToMarkdown("<h2>Sub</h2>")).toContain("## Sub");
    expect(htmlToMarkdown("<h3>Sub3</h3>")).toContain("### Sub3");
  });

  it("converts paragraphs", () => {
    expect(htmlToMarkdown("<p>Hello world</p>")).toBe("Hello world\n");
  });

  it("preserves empty paragraphs as blank lines", () => {
    const result = htmlToMarkdown("<p>Line 1</p><p></p><p>Line 3</p>");
    expect(result).toContain("Line 1\n\n");
    expect(result).toContain("Line 3");
  });

  it("converts bold and italic", () => {
    expect(htmlToMarkdown("<p><strong>bold</strong></p>")).toContain("**bold**");
    expect(htmlToMarkdown("<p><em>italic</em></p>")).toContain("*italic*");
  });

  it("converts links", () => {
    expect(htmlToMarkdown('<p><a href="https://example.com">link</a></p>')).toContain("[link](https://example.com)");
  });

  it("converts images", () => {
    expect(htmlToMarkdown('<img src="img.png" alt="photo">')).toContain("![photo](img.png)");
  });

  it("converts unordered lists", () => {
    const html = "<ul><li>A</li><li>B</li></ul>";
    const md = htmlToMarkdown(html);
    expect(md).toContain("- A");
    expect(md).toContain("- B");
  });

  it("converts ordered lists", () => {
    const html = "<ol><li>First</li><li>Second</li></ol>";
    const md = htmlToMarkdown(html);
    expect(md).toContain("1. First");
    expect(md).toContain("2. Second");
  });

  it("converts code blocks", () => {
    const html = '<pre><code class="language-js">const x = 1;</code></pre>';
    const md = htmlToMarkdown(html);
    expect(md).toContain("```js");
    expect(md).toContain("const x = 1;");
  });

  it("converts inline code", () => {
    expect(htmlToMarkdown("<p>Use <code>npm install</code></p>")).toContain("`npm install`");
  });

  it("converts blockquotes", () => {
    const html = "<blockquote><p>Quote</p></blockquote>";
    expect(htmlToMarkdown(html)).toContain("> Quote");
  });

  it("converts tables", () => {
    const html = "<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>";
    const md = htmlToMarkdown(html);
    expect(md).toContain("| A | B |");
    expect(md).toContain("| --- | --- |");
    expect(md).toContain("| 1 | 2 |");
  });

  it("converts horizontal rules", () => {
    expect(htmlToMarkdown("<hr>")).toContain("---");
  });

  it("converts strikethrough", () => {
    expect(htmlToMarkdown("<p><del>removed</del></p>")).toContain("~~removed~~");
  });

  it("converts highlight/mark", () => {
    expect(htmlToMarkdown("<p><mark>highlight</mark></p>")).toContain("==highlight==");
  });

  it("handles empty input", () => {
    expect(htmlToMarkdown("")).toBe("");
    expect(htmlToMarkdown("   ")).toBe("");
  });
});

// ─── markdownToHtml ──────────────────────────────────────────────────

describe("markdownToHtml", () => {
  it("converts headings", () => {
    expect(markdownToHtml("# Title")).toContain("<h1>Title</h1>");
    expect(markdownToHtml("## Sub")).toContain("<h2>Sub</h2>");
  });

  it("converts paragraphs", () => {
    expect(markdownToHtml("Hello")).toContain("<p>Hello</p>");
  });

  it("converts bold and italic", () => {
    expect(markdownToHtml("**bold**")).toContain("<strong>bold</strong>");
    expect(markdownToHtml("*italic*")).toContain("<em>italic</em>");
  });

  it("converts links", () => {
    expect(markdownToHtml("[link](https://example.com)")).toContain('<a href="https://example.com">link</a>');
  });

  it("converts images", () => {
    expect(markdownToHtml("![alt](img.png)")).toContain('<img src="img.png" alt="alt">');
  });

  it("converts unordered lists", () => {
    const html = markdownToHtml("- A\n- B");
    expect(html).toContain("<ul>");
    expect(html).toContain("<li>");
  });

  it("converts ordered lists", () => {
    const html = markdownToHtml("1. First\n2. Second");
    expect(html).toContain("<ol>");
  });

  it("converts code blocks", () => {
    const html = markdownToHtml("```js\nconst x = 1;\n```");
    expect(html).toContain("<pre><code");
    expect(html).toContain("const x = 1;");
  });

  it("converts task lists", () => {
    const html = markdownToHtml("- [x] Done\n- [ ] Todo");
    expect(html).toContain('data-checked="true"');
    expect(html).toContain('data-checked="false"');
  });

  it("converts blockquotes", () => {
    expect(markdownToHtml("> Quote")).toContain("<blockquote>");
  });

  it("converts horizontal rules", () => {
    expect(markdownToHtml("---")).toContain("<hr>");
  });

  it("handles empty input", () => {
    expect(markdownToHtml("")).toBe("");
  });
});

// ─── Round-trip ──────────────────────────────────────────────────────

describe("round-trip HTML → MD → HTML", () => {
  it("preserves basic formatting", () => {
    const original = "<p><strong>bold</strong> and <em>italic</em></p>";
    const md = htmlToMarkdown(original);
    const backToHtml = markdownToHtml(md);
    expect(backToHtml).toContain("<strong>bold</strong>");
    expect(backToHtml).toContain("<em>italic</em>");
  });
});

// ─── Wikilinks ───────────────────────────────────────────────────────

describe("wikilinks", () => {
  const idToTitle = new Map([
    ["abc-123", "Meeting Notes"],
    ["def-456", "Project Plan"],
  ]);
  const titleToId = new Map([
    ["Meeting Notes", "abc-123"],
    ["Project Plan", "def-456"],
  ]);

  it("converts internal links to wikilinks", () => {
    const md = "See [Meeting Notes](/dashboard/notes/abc-123) for details.";
    const result = internalLinksToWikilinks(md, idToTitle);
    expect(result).toContain("[[Meeting Notes]]");
  });

  it("converts wikilinks to internal links", () => {
    const md = "See [[Meeting Notes]] for details.";
    const result = wikilinksToInternalLinks(md, titleToId);
    expect(result).toContain("[Meeting Notes](/dashboard/notes/abc-123)");
  });

  it("handles wikilinks with display text", () => {
    const md = "See [[Meeting Notes|notes]] for details.";
    const result = wikilinksToInternalLinks(md, titleToId);
    expect(result).toContain("[notes](/dashboard/notes/abc-123)");
  });

  it("leaves unresolved wikilinks as plain text", () => {
    const md = "See [[Unknown Note]] here.";
    const result = wikilinksToInternalLinks(md, titleToId);
    expect(result).toContain("Unknown Note");
    expect(result).not.toContain("[[");
  });
});

// ─── noteToMarkdown / markdownToNote ─────────────────────────────────

describe("noteToMarkdown", () => {
  const sampleNote: NoteForExport = {
    id: "test-uuid-123",
    title: "Test Note",
    content: "<p>Hello <strong>world</strong></p>",
    metadata: { type: "idea", topics: ["product", "design"], people: ["Sarah"] },
    tags: ["product"],
    created_at: "2026-01-15T10:00:00Z",
    updated_at: "2026-01-16T12:00:00Z",
  };

  it("generates YAML frontmatter", () => {
    const md = noteToMarkdown(sampleNote);
    expect(md).toContain("---");
    expect(md).toContain("id: test-uuid-123");
    expect(md).toContain("title: Test Note");
  });

  it("includes tags from both tags and metadata.topics", () => {
    const md = noteToMarkdown(sampleNote);
    expect(md).toContain("product");
    expect(md).toContain("design");
  });

  it("includes people", () => {
    const md = noteToMarkdown(sampleNote);
    expect(md).toContain("Sarah");
  });

  it("includes menerio_metadata as base64", () => {
    const md = noteToMarkdown(sampleNote);
    expect(md).toContain("menerio_metadata:");
  });

  it("contains markdown body", () => {
    const md = noteToMarkdown(sampleNote);
    expect(md).toContain("Hello **world**");
  });
});

describe("markdownToNote", () => {
  it("parses frontmatter and body", () => {
    const md = `---
id: abc-123
title: My Note
tags:
  - test
type: idea
---

Hello **world**
`;
    const note = markdownToNote(md);
    expect(note.id).toBe("abc-123");
    expect(note.title).toBe("My Note");
    expect(note.tags).toContain("test");
    expect(note.entity_type).toBe("idea");
    expect(note.content).toContain("<strong>world</strong>");
  });

  it("restores menerio_metadata from base64", () => {
    const originalMeta = { type: "idea", topics: ["x"], custom_field: 42 };
    const encoded = btoa(JSON.stringify(originalMeta));
    const md = `---
title: Test
menerio_metadata: ${encoded}
---

Content here
`;
    const note = markdownToNote(md);
    expect(note.metadata).toEqual(originalMeta);
  });

  it("handles notes with no frontmatter", () => {
    const note = markdownToNote("Just plain text");
    expect(note.title).toBe("");
    expect(note.content).toContain("Just plain text");
  });

  it("handles empty notes", () => {
    const note = markdownToNote("");
    expect(note.title).toBe("");
    expect(note.content).toBe("");
  });
});

// ─── Round-trip: noteToMarkdown → markdownToNote ─────────────────────

describe("full round-trip", () => {
  it("preserves metadata through export and reimport", () => {
    const original: NoteForExport = {
      id: "round-trip-id",
      title: "Round Trip Test",
      content: "<p>Content with <em>emphasis</em></p>",
      metadata: { type: "meeting", topics: ["q2", "planning"], people: ["Alice"], score: 0.95 },
      tags: ["q2", "planning"],
      created_at: "2026-03-01T08:00:00Z",
      updated_at: "2026-03-02T09:00:00Z",
      entity_type: "meeting",
    };

    const md = noteToMarkdown(original);
    const reimported = markdownToNote(md);

    expect(reimported.id).toBe(original.id);
    expect(reimported.title).toBe(original.title);
    expect(reimported.metadata).toEqual(original.metadata);
    expect(reimported.tags).toEqual(expect.arrayContaining(original.tags));
  });
});

// ─── File path utilities ─────────────────────────────────────────────

describe("noteToFilePath", () => {
  it("generates a simple filename", () => {
    const note: NoteForExport = {
      id: "1", title: "My Note", content: "", metadata: null,
      tags: [], created_at: "", updated_at: "",
    };
    expect(noteToFilePath(note)).toBe("My Note.md");
  });

  it("places quick captures in Inbox/", () => {
    const note: NoteForExport = {
      id: "1", title: "Quick thought", content: "",
      metadata: { is_quick_capture: true },
      tags: [], created_at: "", updated_at: "",
    };
    expect(noteToFilePath(note)).toBe("Inbox/Quick thought.md");
  });

  it("respects vault path", () => {
    const note: NoteForExport = {
      id: "1", title: "Note", content: "", metadata: null,
      tags: [], created_at: "", updated_at: "",
    };
    expect(noteToFilePath(note, "/brain")).toBe("brain/Note.md");
  });

  it("sanitizes special characters", () => {
    const note: NoteForExport = {
      id: "1", title: 'Meeting: "Q2" <plan>', content: "", metadata: null,
      tags: [], created_at: "", updated_at: "",
    };
    const path = noteToFilePath(note);
    expect(path).not.toContain(":");
    expect(path).not.toContain('"');
    expect(path).not.toContain("<");
  });

  it("handles untitled notes", () => {
    const note: NoteForExport = {
      id: "1", title: "", content: "", metadata: null,
      tags: [], created_at: "", updated_at: "",
    };
    expect(noteToFilePath(note)).toBe("Untitled.md");
  });
});

describe("filePathToNoteTitle", () => {
  it("extracts title from simple path", () => {
    expect(filePathToNoteTitle("My Note.md")).toBe("My Note");
  });

  it("strips directory path", () => {
    expect(filePathToNoteTitle("Projects/Menerio.md")).toBe("Menerio");
  });

  it("handles nested paths", () => {
    expect(filePathToNoteTitle("brain/Inbox/Quick thought.md")).toBe("Quick thought");
  });
});
