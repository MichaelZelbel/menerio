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
  tiptapJsonToMarkdown,
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

  it("preserves mailto links next to hard-break markers", () => {
    const html = markdownToHtml("Email:\\\n[user@example.com](mailto:user@example.com)\\\nDone");
    expect(html).toContain('<a href="mailto:user@example.com">user@example.com</a>');
  });

  it("renders Obsidian wikilinks as visible editor nodes", () => {
    const html = markdownToHtml("See [[Target Note|the note]] today");
    expect(html).toContain('data-wikilink="true"');
    expect(html).toContain('data-note-title="Target Note"');
    expect(html).toContain('[[the note]]');
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

  it("keeps markdown headings as heading nodes", () => {
    expect(markdownToHtml("# Title")).toBe("<h1>Title</h1>");
    expect(markdownToHtml("## Subtitle")).toBe("<h2>Subtitle</h2>");
  });

  it("does not turn hard-break markers into literal backslashes", () => {
    const once = markdownToHtml("First\\\nSecond");
    const twice = markdownToHtml(htmlToMarkdown(once));
    expect(once).toBe("<p>First<br>Second</p>");
    expect(twice).not.toContain("\\");
  });

  it("keeps bullet lists tight without extra hard-break lines", () => {
    const html = markdownToHtml("- One\n- Two");
    expect(html).toBe("<ul><li><p>One</p></li><li><p>Two</p></li></ul>");
  });

  it("preserves links inside indented bullet lists", () => {
    const html = markdownToHtml("- Parent\n  - [https://test.com](https://test.com)\n  - Child");
    expect(html).toContain("<ul><li><p>Parent</p><ul>");
    expect(html).toContain('<a href="https://test.com">https://test.com</a>');
    expect(html).toContain("<li><p>Child</p></li>");
  });

  it("preserves multiple links in older resource-style notes", () => {
    const html = markdownToHtml("# Sources\n\n- Check competitor: [https://mymarky.ai/](https://mymarky.ai/)\n- Check Late: [https://appsumo.com/products/late/](https://appsumo.com/products/late/)");
    expect(html.match(/<a href=/g)?.length).toBe(2);
    expect(html).toContain('href="https://mymarky.ai/"');
    expect(html).toContain('href="https://appsumo.com/products/late/"');
  });

  it("coalesces blank-line-separated task list items into a single list", () => {
    const md = "- [x] Item A.\n\n- [x] Item B.\n\n- [ ] Item C.";
    const html = markdownToHtml(md);
    // All three items appear as task-list items in one list
    const taskLists = html.match(/<ul[^>]*data-type="taskList"[^>]*>/g) || [];
    expect(taskLists.length).toBe(1);
    expect(html).toContain("Item A.");
    expect(html).toContain("Item B.");
    expect(html).toContain("Item C.");
  });

  it("preserves mixed checked/unchecked states when coalescing", () => {
    const md = "- [x] Done\n\n- [ ] Todo\n\n- [x] Also done";
    const html = markdownToHtml(md);
    expect(html.match(/data-checked="true"/g)?.length).toBe(2);
    expect(html.match(/data-checked="false"/g)?.length).toBe(1);
  });

  it("is idempotent on already-tight task lists", () => {
    const md = "- [x] A\n- [ ] B\n- [x] C";
    const html = markdownToHtml(md);
    const taskLists = html.match(/<ul[^>]*data-type="taskList"[^>]*>/g) || [];
    expect(taskLists.length).toBe(1);
    expect(html.match(/data-checked=/g)?.length).toBe(3);
  });

  it("does NOT coalesce regular bullet lists separated by blank lines", () => {
    const md = "- A\n\n- B";
    const html = markdownToHtml(md);
    // Regular bullets stay as separate paragraphs/lists — no task-list markup
    expect(html).not.toContain('data-type="taskList"');
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

describe("TipTap JSON → Markdown", () => {
  it("serializes headings, bullets, normal links, and wikilinks without HTML loss", () => {
    const md = tiptapJsonToMarkdown({
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Title" }] },
        { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Item" }] }] }] },
        { type: "paragraph", content: [
          { type: "text", text: "Open ", marks: [] },
          { type: "text", text: "site", marks: [{ type: "link", attrs: { href: "https://example.com" } }] },
          { type: "text", text: " and " },
          { type: "wikilink", attrs: { noteTitle: "Target", displayText: "Alias" } },
        ] },
      ],
    });

    expect(md).toContain("# Title");
    expect(md).toContain("- Item");
    expect(md).toContain("[site](https://example.com)");
    expect(md).toContain("[[Target|Alias]]");
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

// ─── List continuation lines (regression: text under list items used to disappear) ──

describe("markdownToHtml: list continuation lines", () => {
  it("preserves a non-list line that follows a list item", () => {
    const md = `- Skill Creator:\n/plugin install skill-creator@claude-plugins-official\n- Super Powers:`;
    const html = markdownToHtml(md);
    expect(html).toContain("/plugin install skill-creator@claude-plugins-official");
    expect(html).toContain("Skill Creator:");
    expect(html).toContain("Super Powers:");
  });

  it("does not drop continuation text for at-mention-like tokens", () => {
    const md = `- Item one\n@scope/package@1.2.3\n- Item two`;
    const html = markdownToHtml(md);
    expect(html).toContain("@scope/package@1.2.3");
  });
});

// ─── Blank-line preservation (Obsidian parity) ─────────────────────────

describe("blank line preservation", () => {
  it("markdownToHtml emits empty paragraphs for extra blank lines", () => {
    const html = markdownToHtml("A\n\n\n\nB");
    // one normal gap + 2 extra blank lines = 2 empty paragraphs between A and B
    expect(html).toBe("<p>A</p><p></p><p></p><p>B</p>");
  });

  it("tiptapJsonToMarkdown preserves empty paragraphs as blank lines", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "A" }] },
        { type: "paragraph" },
        { type: "paragraph" },
        { type: "paragraph", content: [{ type: "text", text: "B" }] },
      ],
    };
    expect(tiptapJsonToMarkdown(doc)).toBe("A\n\n\n\nB");
  });

  it("round-trips: markdown → html → markdown keeps blank lines", () => {
    const md = "A\n\n\n\nB";
    const html = markdownToHtml(md);
    // simulate tiptap document shape derived from html paragraphs
    const paragraphs = html.match(/<p>(.*?)<\/p>/g) || [];
    const doc = {
      type: "doc",
      content: paragraphs.map((p) => {
        const text = p.replace(/<\/?p>/g, "");
        return text
          ? { type: "paragraph", content: [{ type: "text", text }] }
          : { type: "paragraph" };
      }),
    };
    expect(tiptapJsonToMarkdown(doc)).toBe(md);
  });

  it("htmlToMarkdown turns empty paragraphs into blank lines", () => {
    const md = htmlToMarkdown("<p>A</p><p></p><p>B</p>");
    expect(md.trim()).toBe("A\n\n\nB");
  });
});
