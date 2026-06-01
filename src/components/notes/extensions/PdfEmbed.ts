import { Node, mergeAttributes } from "@tiptap/core";

/**
 * PDF embed node for TipTap.
 * Renders as an <iframe> with PDF viewer.
 * Markdown output: `![[file.pdf]]` (Obsidian-compatible) when the embed
 * was created from an uploaded attachment, otherwise `![pdf](url)`.
 */
export const PdfEmbed = Node.create({
  name: "pdfEmbed",
  group: "block",
  atom: true,

  addAttributes() {
    return {
      src: { default: null },
      title: { default: null },
      "data-attachment-name": {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute("data-attachment-name"),
        renderHTML: (attrs: Record<string, unknown>) => {
          const v = attrs["data-attachment-name"];
          return v ? { "data-attachment-name": String(v) } : {};
        },
      },
    };
  },

  parseHTML() {
    return [{ tag: "iframe[data-type='pdf']" }];
  },

  renderHTML({ HTMLAttributes }) {
    const attachName = HTMLAttributes["data-attachment-name"];
    return [
      "div",
      { class: "embed-pdf-wrapper" },
      [
        "iframe",
        mergeAttributes(
          {
            src: HTMLAttributes.src || "about:blank",
            frameborder: "0",
            "data-type": "pdf",
          },
          {
            title: HTMLAttributes.title || "PDF document",
            ...(attachName ? { "data-attachment-name": String(attachName) } : {}),
          }
        ),
      ],
    ];
  },

  addCommands() {
    return {
      setPdfEmbed:
        (attrs: { src: string; title?: string; "data-attachment-name"?: string }) =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs,
          });
        },
    } as any;
  },
});
