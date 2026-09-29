/**
 * Load/save regressions, run through a real TipTap editor configured like the
 * note editor: Markdown -> markdownToHtml -> editor -> tiptapJsonToMarkdown.
 * Every case checks that the saved Markdown keeps the user's content and that
 * a second open-and-save leaves it unchanged.
 *
 * The harness enables StarterKit's code block, which is the editor config
 * change this suite asks for (NoteEditor and RichTextEditor still pass
 * `codeBlock: false`).
 */
import { describe, expect, it } from "vitest";
import { Editor, type JSONContent } from "@tiptap/core";
import { looksLikeHtml } from "@/lib/note-content";
import { buildTitleMap } from "@/lib/wikilink-resolver";
import { appendWikilinkToContent, markdownToHtml, tiptapJsonToMarkdown } from "../markdown-converter";
import { editorToMarkdown, loadIntoEditor, noteEditorExtensions, roundTrip } from "./editor-roundtrip-harness";

/** Saved Markdown after one open-and-save, asserting a second one changes nothing. */
function saveTwice(md: string): string {
  const once = roundTrip(md);
  expect(roundTrip(once)).toBe(once);
  return once;
}

function withEditor<T>(md: string, fn: (editor: Editor) => T): T {
  const editor = loadIntoEditor(md);
  try {
    return fn(editor);
  } finally {
    editor.destroy();
  }
}

/** Editor built from a TipTap document, saved, reopened: the text it shows. */
function textAfterSaveAndReload(doc: JSONContent): { md: string; text: string } {
  const editor = new Editor({ extensions: noteEditorExtensions(), content: doc });
  const md = editorToMarkdown(editor);
  editor.destroy();
  const text = withEditor(md, (e) => e.getText());
  expect(roundTrip(md)).toBe(md);
  return { md, text };
}

const paragraph = (...content: JSONContent[]): JSONContent => ({ type: "doc", content: [{ type: "paragraph", content }] });
const text = (value: string, marks?: JSONContent["marks"]): JSONContent => ({ type: "text", text: value, ...(marks ? { marks } : {}) });

function findNodes(node: JSONContent, type: string, out: JSONContent[] = []): JSONContent[] {
  if (node.type === type) out.push(node);
  (node.content || []).forEach((child) => findNodes(child, type, out));
  return out;
}

function markTypes(node: JSONContent): string[] {
  const types = new Set<string>();
  const walk = (n: JSONContent) => {
    (n.marks || []).forEach((m) => types.add(m.type));
    (n.content || []).forEach(walk);
  };
  walk(node);
  return [...types].sort();
}

// ─── 1. Fenced code ──────────────────────────────────────────────────

describe("round trip: fenced code", () => {
  it("keeps a fence written directly under a line of text", () => {
    const md = "Run this:\n```bash\nkubectl rollout restart deploy/api\n```\nThen check the logs.";
    expect(saveTwice(md)).toBe("Run this:\n\n```bash\nkubectl rollout restart deploy/api\n```\n\nThen check the logs.");
  });

  it("keeps the code of a fence inside a list item", () => {
    const saved = saveTwice("- step one\n  ```bash\n  ls -la\n  ```\n- step two");
    expect(saved).toBe("- step one\n\n```bash\nls -la\n```\n\n- step two");
  });

  it("keeps the code of a fence opened on the bullet line itself", () => {
    expect(saveTwice("- ```bash\n  ls -la\n  ```\n- next")).toBe("```bash\nls -la\n```\n\n- next");
  });

  it("keeps a fence inside a blockquote", () => {
    const md = "> quote\n>\n> ```js\n> const x = 1;\n> ```";
    expect(saveTwice(md)).toBe(md);
  });

  it("round-trips a code block unchanged, language included", () => {
    const md = "```yaml\nkey:\n  nested: 1\n```";
    expect(saveTwice(md)).toBe(md);
    withEditor(md, (editor) => {
      const [block] = findNodes(editor.getJSON(), "codeBlock");
      expect(block?.attrs?.language).toBe("yaml");
    });
  });

  it("keeps blank lines, indentation and shell line continuations inside code", () => {
    const md = "Intro\n\n```bash\ndocker run \\\n  -p 80:80 nginx\n\n    # indented after a blank line\n```\n\nAfter";
    expect(saveTwice(md)).toBe(md);
  });

  it("writes a longer fence around code that itself contains a fence", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [{ type: "codeBlock", attrs: { language: "md" }, content: [text("```js\nx\n```")] }],
    };
    const { md } = textAfterSaveAndReload(doc);
    expect(md).toBe("````md\n```js\nx\n```\n````");
  });

  it("makes the toolbar's code block button work and save as a fence", () => {
    const editor = loadIntoEditor("echo hi");
    editor.commands.setTextSelection(1);
    expect(editor.commands.toggleCodeBlock()).toBe(true);
    expect(editorToMarkdown(editor)).toBe("```\necho hi\n```");
    editor.destroy();
  });

  it("never turns text that merely looks like an old placeholder into code", () => {
    const html = markdownToHtml("%%CODEBLOCK\\_0%%\n\n```js\nx\n```");
    expect(html).toContain("<p>%%CODEBLOCK_0%%</p>");
    expect(html.match(/<pre>/g)?.length).toBe(1);
  });
});

// ─── 2. Angle brackets ───────────────────────────────────────────────

describe("round trip: text in angle brackets", () => {
  it("keeps List<String> and <anna@example.com>", () => {
    const md = "Use List<String> here and mail <anna@example.com> ok";
    const saved = saveTwice(md);
    expect(saved).toBe("Use List\\<String> here and mail \\<anna@example.com> ok");
    withEditor(saved, (editor) => expect(editor.getText()).toBe(md));
  });

  it("keeps typed tag-like text as text, not formatting", () => {
    const { md, text: shown } = textAfterSaveAndReload(paragraph(text("a <b>not bold</b> and <u>not underlined</u>")));
    expect(shown).toBe("a <b>not bold</b> and <u>not underlined</u>");
    expect(md).not.toMatch(/(^|[^\\])<b>/);
  });

  it("does not let a typed block tag turn the note into HTML", () => {
    const typed = "wrap it in <table> or <p> tags";
    const { md, text: shown } = textAfterSaveAndReload(paragraph(text(typed)));
    expect(looksLikeHtml(md)).toBe(false);
    expect(shown).toBe(typed);
  });

  it("keeps typed entity-like text such as &lt; and &nbsp;", () => {
    const typed = "write &lt; or &nbsp; literally, AT&T stays";
    expect(textAfterSaveAndReload(paragraph(text(typed))).text).toBe(typed);
  });

  it("still loads the inline tags it supports as formatting", () => {
    const md = "<u>under</u> x<sup>2</sup> H<sub>2</sub>O";
    expect(saveTwice(md)).toBe(md);
    withEditor(md, (editor) => expect(markTypes(editor.getJSON())).toEqual(["subscript", "superscript", "underline"]));
  });
});

// ─── 3. Tables ───────────────────────────────────────────────────────

describe("round trip: GFM tables", () => {
  it("does not add an empty column on every save", () => {
    const md = "| A | B |\n| --- | --- |\n| 1 | 2 |";
    expect(saveTwice(md)).toBe(md);
  });

  it("keeps the first column of a table written without outer pipes", () => {
    expect(saveTwice("A | B\n--- | ---\n1 | 2")).toBe("| A | B |\n| --- | --- |\n| 1 | 2 |");
  });

  it("reads the alignment row as alignment and writes it back", () => {
    const md = "| Left | Right | Mid |\n| :--- | ---: | :---: |\n| 1 | 2 | 3 |";
    expect(saveTwice(md)).toBe(md);
    expect(saveTwice("|A|B|\n|:---|---:|\n|1|2|")).toBe("| A | B |\n| :--- | ---: |\n| 1 | 2 |");
  });

  it("keeps a line of text written directly above a table", () => {
    expect(saveTwice("Intro line\n| A | B |\n| --- | --- |\n| 1 | 2 |")).toBe(
      "Intro line\n\n| A | B |\n| --- | --- |\n| 1 | 2 |",
    );
  });

  it("escapes a pipe inside a cell and keeps wikilink aliases and code intact", () => {
    const md = "| Expr | Link | Code |\n| --- | --- | --- |\n| a \\| b | [[Target\\|Alias]] | `x \\| y` |";
    expect(saveTwice(md)).toBe(md);
    withEditor(md, (editor) => {
      const json = editor.getJSON();
      expect(editor.getText()).toContain("a | b");
      const [link] = findNodes(json, "wikilink");
      expect(link?.attrs).toMatchObject({ noteTitle: "Target", displayText: "Alias" });
      expect(JSON.stringify(json)).toContain('"text":"x | y"');
    });
  });

  it("writes a line break inside a cell as <br> so the row stays one line", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [{
        type: "table",
        content: [
          { type: "tableRow", content: [
            { type: "tableHeader", content: [{ type: "paragraph", content: [text("H")] }] },
          ] },
          { type: "tableRow", content: [
            { type: "tableCell", content: [{ type: "paragraph", content: [text("one"), { type: "hardBreak" }, text("two")] }] },
          ] },
        ],
      }],
    };
    const { md, text: shown } = textAfterSaveAndReload(doc);
    expect(md).toBe("| H |\n| --- |\n| one<br>two |");
    expect(shown).toContain("one");
    expect(shown).toContain("two");
  });
});

// ─── 4. Toolbar marks ────────────────────────────────────────────────

describe("round trip: formatting the toolbar offers", () => {
  it("keeps highlight, underline, superscript, subscript and text color", () => {
    const md = 'A ==marked== <u>under</u> x<sup>2</sup> H<sub>2</sub>O <span style="color: hsl(0, 72%, 51%)">red</span>';
    expect(saveTwice(md)).toBe(md);
    withEditor(md, (editor) =>
      expect(markTypes(editor.getJSON())).toEqual(["highlight", "subscript", "superscript", "textStyle", "underline"]),
    );
  });

  it("keeps marks applied with the editor commands", () => {
    const editor = loadIntoEditor("alpha beta gamma delta epsilon");
    const select = (from: number, to: number) => editor.chain().setTextSelection({ from, to });
    select(1, 6).toggleHighlight().run();
    select(7, 11).toggleUnderline().run();
    select(12, 17).setColor("hsl(217, 91%, 60%)").run();
    select(18, 23).toggleSuperscript().run();
    select(24, 31).toggleSubscript().run();
    const md = editorToMarkdown(editor);
    editor.destroy();
    expect(md).toBe(
      '==alpha== <u>beta</u> <span style="color: hsl(217, 91%, 60%)">gamma</span> <sup>delta</sup> <sub>epsilon</sub>',
    );
    expect(roundTrip(md)).toBe(md);
  });

  it("keeps a colored highlight", () => {
    const doc = paragraph(text("hot", [{ type: "highlight", attrs: { color: "#fde68a" } }]));
    const { md, text: shown } = textAfterSaveAndReload(doc);
    expect(md).toBe('<mark data-color="#fde68a">hot</mark>');
    expect(shown).toBe("hot");
  });

  it("keeps prose with two == pairs as typed", () => {
    const md = "if x == 1 and y == 2";
    expect(saveTwice(md)).toBe(md);
  });

  it("escapes == and ~~ in text that could be read as a highlight or strikethrough", () => {
    const typed = "a==b==c and x~~y~~z";
    const { md, text: shown } = textAfterSaveAndReload(paragraph(text(typed)));
    expect(md).toBe("a\\=\\=b\\=\\=c and x\\~\\~y\\~\\~z");
    expect(shown).toBe(typed);
  });
});

// ─── 5. Video and audio embeds ───────────────────────────────────────

describe("round trip: video and audio embeds", () => {
  it.each([
    ["videoEmbed", "![video](https://example.com/clip.mp4)"],
    ["videoEmbed", "![video](https://www.youtube.com/watch?v=dQw4w9WgXcQ)"],
    ["audioEmbed", "![audio](https://example.com/talk.mp3)"],
  ])("loads %s from %s and saves it back", (nodeType, md) => {
    expect(saveTwice(md)).toBe(md);
    withEditor(md, (editor) => {
      const [embed] = findNodes(editor.getJSON(), nodeType);
      expect(embed?.attrs?.src).toBe(md.slice(md.indexOf("(") + 1, -1));
      expect(findNodes(editor.getJSON(), "image")).toHaveLength(0);
    });
  });

  it("leaves an image whose alt text is 'video' an image", () => {
    const md = "![video](https://example.com/poster.png)";
    expect(saveTwice(md)).toBe(md);
    withEditor(md, (editor) => expect(findNodes(editor.getJSON(), "image")).toHaveLength(1));
  });
});

// ─── 6. Link to note ─────────────────────────────────────────────────

describe("appendWikilinkToContent (Link to note dialog)", () => {
  const titleMap = buildTitleMap([{ id: "note-42", title: "Target Note" }]);

  it("appends [[Title]] as Markdown, keeping the note Markdown", () => {
    const content = "![[photo.png]]\n\nline one\nline two";
    const updated = appendWikilinkToContent(content, "note-42", "Target Note");
    expect(updated).toBe("![[photo.png]]\n\nline one\nline two\n\n[[Target Note]]");
    expect(looksLikeHtml(updated)).toBe(false);

    const editor = loadIntoEditor(updated, { titleMap });
    const json = editor.getJSON();
    const saved = editorToMarkdown(editor);
    editor.destroy();
    // The node NoteEditor's syncManualLinks reads, with the note id resolved.
    expect(findNodes(json, "wikilink")[0]?.attrs).toMatchObject({ noteId: "note-42", noteTitle: "Target Note" });
    expect(saved).toBe(updated);
  });

  it("does not append the same link twice", () => {
    const once = appendWikilinkToContent("Body", "note-42", "Target Note");
    expect(appendWikilinkToContent(once, "note-42", "Target Note")).toBe(once);
    expect(appendWikilinkToContent("See [[target note|it]]", "note-42", "Target Note")).toBe("See [[target note|it]]");
  });

  it("handles an empty note", () => {
    expect(appendWikilinkToContent(null, "note-42", "Target Note")).toBe("[[Target Note]]");
  });

  it("links a title that cannot be written inside [[ ]] with a Markdown link", () => {
    const updated = appendWikilinkToContent("Body", "note-7", "A | B [draft]");
    expect(updated).toBe("Body\n\n[A | B \\[draft\\]](/dashboard/notes/note-7)");
    withEditor(updated, (editor) => expect(editor.getText()).toContain("A | B [draft]"));
  });

  it("appends the wikilink node markup, escaped and with its id, to a legacy HTML note", () => {
    const updated = appendWikilinkToContent("<p>Hello</p>", "note-9", 'Q&A "notes" <v2>');
    expect(updated).toContain('data-note-title="Q&amp;A &quot;notes&quot; &lt;v2&gt;"');
    withEditor(updated, (editor) => {
      const [link] = findNodes(editor.getJSON(), "wikilink");
      expect(link?.attrs).toMatchObject({ noteId: "note-9", noteTitle: 'Q&A "notes" <v2>' });
      expect(editor.getText()).toContain("Hello");
    });
  });
});

// ─── 7. Lists and links ──────────────────────────────────────────────

describe("round trip: list numbering, line breaks in items, links with parentheses", () => {
  it("keeps the start number of an ordered list", () => {
    expect(saveTwice("3. third\n4. fourth")).toBe("3. third\n4. fourth");
    expect(saveTwice("0. zero\n1. one")).toBe("0. zero\n1. one");
    expect(saveTwice("1. one\n   5. nested five\n2. two")).toBe("1. one\n  5. nested five\n2. two");
  });

  it("keeps a Shift+Enter line break inside a list item in the list", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [{
        type: "bulletList",
        content: [
          { type: "listItem", content: [{ type: "paragraph", content: [text("one"), { type: "hardBreak" }, text("continued")] }] },
          { type: "listItem", content: [{ type: "paragraph", content: [text("two")] }] },
        ],
      }],
    };
    const { md } = textAfterSaveAndReload(doc);
    expect(md).toBe("- one\n  continued\n- two");
    withEditor(md, (editor) => {
      expect(findNodes(editor.getJSON(), "bulletList")).toHaveLength(1);
      expect(findNodes(editor.getJSON(), "listItem")).toHaveLength(2);
    });
  });

  it("keeps line breaks in nested and task items inside their item", () => {
    const md = "- a\n  - b\n    more\n- c\n\n- [ ] task\n  details";
    expect(saveTwice(md)).toBe(md);
  });

  it("keeps a link whose address contains parentheses", () => {
    const md = "See [Mercury](https://en.wikipedia.org/wiki/Mercury_(planet)) now";
    expect(saveTwice(md)).toBe(md);
    withEditor(md, (editor) => {
      const marks = JSON.stringify(editor.getJSON());
      expect(marks).toContain('"href":"https://en.wikipedia.org/wiki/Mercury_(planet)"');
      expect(editor.getText()).toBe("See Mercury now");
    });
  });

  it("percent-encodes an unbalanced parenthesis so it cannot end the link", () => {
    const doc = paragraph(text("odd", [{ type: "link", attrs: { href: "https://example.com/a)b" } }]));
    const md = tiptapJsonToMarkdown(doc as Parameters<typeof tiptapJsonToMarkdown>[0]);
    expect(md).toBe("[odd](https://example.com/a%29b)");
    expect(saveTwice(md)).toBe(md);
  });
});

// ─── Inline code ─────────────────────────────────────────────────────

describe("round trip: inline code and literal backticks", () => {
  it("does not add backslashes inside inline code on every save", () => {
    const md = "Use `a_b*c` and `List<T>` and `[x]` now";
    expect(saveTwice(md)).toBe(md);
  });

  it("keeps code holding a backtick or ending in a backslash", () => {
    expect(saveTwice("run `` a`b `` now")).toBe("run `` a`b `` now");
    expect(saveTwice("path `C:\\` ok")).toBe("path `C:\\` ok");
  });

  it("keeps typed backticks, including an unclosed fence, as text", () => {
    const typed = "use `a` and ``` here";
    const { md, text: shown } = textAfterSaveAndReload(paragraph(text(typed)));
    expect(shown).toBe(typed);
    expect(md).toBe("use \\`a\\` and \\`\\`\\` here");
    expect(saveTwice("```js\nconst a = 1;")).toBe("\\`\\`\\`js\nconst a = 1;");
  });
});
