import { Mark, markInputRule, markPasteRule, mergeAttributes } from "@tiptap/core";

export const WIKI_LINK_REGEX = /\[\[([a-z0-9-]+)\]\]$/;
export const WIKI_LINK_PASTE_REGEX = /\[\[([a-z0-9-]+)\]\]/g;

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    wikiLink: {
      setWikiLink: (attrs: { slug: string }) => ReturnType;
      unsetWikiLink: () => ReturnType;
    };
  }
}

export const WikiLinkMark = Mark.create({
  name: "wikiLink",
  inclusive: false,

  addAttributes() {
    return {
      slug: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-slug"),
        renderHTML: (attributes) => ({
          "data-slug": attributes.slug,
          href: `/lexicon/${attributes.slug}`,
          class: "wiki-link",
          title: attributes.slug,
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "a[data-slug]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["a", mergeAttributes(HTMLAttributes), 0];
  },

  addCommands() {
    return {
      setWikiLink:
        (attrs) =>
        ({ commands }) =>
          commands.setMark(this.name, attrs),
      unsetWikiLink:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
    };
  },

  addInputRules() {
    return [
      markInputRule({
        find: WIKI_LINK_REGEX,
        type: this.type,
        getAttributes: (match) => ({ slug: match[1] }),
      }),
    ];
  },

  addPasteRules() {
    return [
      markPasteRule({
        find: WIKI_LINK_PASTE_REGEX,
        type: this.type,
        getAttributes: (match) => ({ slug: match[1] }),
      }),
    ];
  },

  markdownTokenName: "wikiLink",
  markdownTokenizer: {
    name: "wikiLink",
    level: "inline",
    start: "[[",
    tokenize(src) {
      const match = src.match(/^\[\[([a-z0-9-]+)\]\]/);
      if (!match) return undefined;
      return {
        type: "wikiLink",
        raw: match[0],
        text: match[1],
        slug: match[1],
        tokens: [{ type: "text", raw: match[1], text: match[1] }],
      };
    },
  },
  parseMarkdown: (token, helpers) => {
    const slug = token.slug || token.text || "";
    return helpers.applyMark("wikiLink", helpers.parseInline(token.tokens || []), { slug });
  },
  renderMarkdown: (node, helpers) => {
    const slug = node.attrs?.slug || helpers.renderChildren(node);
    return `[[${slug}]]`;
  },
});