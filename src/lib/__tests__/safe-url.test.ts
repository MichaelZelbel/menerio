import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { safeEmbedSrc, safeExternalUrl } from "@/lib/safe-url";
import { safeReturnPath } from "@/lib/return-to";
import { PdfEmbed } from "@/components/notes/extensions/PdfEmbed";
import { VideoEmbed } from "@/components/notes/extensions/VideoEmbed";
import { AudioEmbed } from "@/components/notes/extensions/AudioEmbed";
import { markdownToHtml } from "@/utils/markdown-converter";

describe("safeExternalUrl", () => {
  it("passes ordinary and app-scheme links", () => {
    expect(safeExternalUrl("https://example.com/a?b=1")).toBe("https://example.com/a?b=1");
    expect(safeExternalUrl("  http://example.com ")).toBe("http://example.com");
    expect(safeExternalUrl("obsidian://open?vault=x")).toBe("obsidian://open?vault=x");
    expect(safeExternalUrl("mailto:a@example.com")).toBe("mailto:a@example.com");
  });

  it("refuses script-carrying schemes in every spelling", () => {
    for (const bad of [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      " javascript:alert(1)",
      "java\tscript:alert(1)",
      "java\nscript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "vbscript:msgbox(1)",
      "blob:https://app.example.com/abc",
      "file:///etc/passwd",
    ]) {
      expect(safeExternalUrl(bad), bad).toBeNull();
    }
  });

  it("refuses non-strings and relative values", () => {
    expect(safeExternalUrl(null)).toBeNull();
    expect(safeExternalUrl(42)).toBeNull();
    expect(safeExternalUrl("/dashboard")).toBeNull();
    expect(safeExternalUrl("")).toBeNull();
  });
});

describe("safeEmbedSrc", () => {
  it("keeps http(s) and about:blank, blanks everything else", () => {
    expect(safeEmbedSrc("https://x.example/doc.pdf")).toBe("https://x.example/doc.pdf");
    expect(safeEmbedSrc("about:blank")).toBe("about:blank");
    expect(safeEmbedSrc("javascript:alert(1)")).toBe("about:blank");
    expect(safeEmbedSrc("javascript:alert(1)//youtube")).toBe("about:blank");
    expect(safeEmbedSrc("data:text/html,x")).toBe("about:blank");
    expect(safeEmbedSrc(undefined)).toBe("about:blank");
  });
});

describe("embed nodes never render a script URL", () => {
  const render = (html: string) => {
    const editor = new Editor({ extensions: [StarterKit, PdfEmbed, VideoEmbed, AudioEmbed], content: html });
    const out = editor.getHTML();
    editor.destroy();
    return out;
  };

  it("PDF embed from Markdown ![pdf](javascript:...)", () => {
    const out = render(markdownToHtml("![pdf](javascript:alert(document.domain))"));
    expect(out).toContain('data-type="pdf"');
    expect(out).not.toMatch(/javascript:/i);
  });

  it("PDF embed from a .pdf link with a script href", () => {
    const out = render(markdownToHtml("[x.pdf](javascript:alert(1))"));
    expect(out).not.toMatch(/javascript:/i);
  });

  it("video iframe with a youtube-looking script URL", () => {
    const out = render('<iframe data-type="video" src="javascript:alert(1)//youtube"></iframe>');
    expect(out).not.toMatch(/javascript:/i);
  });

  it("keeps a real https PDF", () => {
    const out = render('<iframe data-type="pdf" src="https://x.example/a.pdf"></iframe>');
    expect(out).toContain('src="https://x.example/a.pdf"');
  });
});

describe("safeReturnPath", () => {
  it("refuses a path the URL parser would turn into another host", () => {
    expect(safeReturnPath("/\t/evil.example")).toBeNull();
    expect(safeReturnPath("//evil.example")).toBeNull();
    expect(safeReturnPath("https://evil.example")).toBeNull();
    expect(safeReturnPath("/dashboard/notes?x=1")).toBe("/dashboard/notes?x=1");
  });
});
