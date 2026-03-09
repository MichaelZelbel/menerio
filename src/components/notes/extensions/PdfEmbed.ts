import { Node, mergeAttributes } from "@tiptap/core";

/**
 * PDF embed node for TipTap.
 * Renders as an <iframe> with PDF viewer.
 * Markdown output: `![pdf](url)` — Obsidian-compatible.
 */
export const PdfEmbed = Node.create({
  name: "pdfEmbed",
  group: "block",
  atom: true,

  addAttributes() {
    return {
      src: { default: null },
      title: { default: null },
    };
  },

  parseHTML() {
    return [{ tag: "iframe[data-type='pdf']" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      { class: "embed-pdf-wrapper" },
      [
        "iframe",
        mergeAttributes(
          {
            src: HTMLAttributes.src,
            frameborder: "0",
            "data-type": "pdf",
          },
          { title: HTMLAttributes.title || "PDF document" }
        ),
      ],
    ];
  },

  addCommands() {
    return {
      setPdfEmbed:
        (attrs: { src: string; title?: string }) =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs,
          });
        },
    } as any;
  },
});
