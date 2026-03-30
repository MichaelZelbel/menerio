import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

/**
 * Tiptap extension that adds Obsidian-style [[wikilink]] support:
 * - Renders [[text]] as styled inline marks
 * - Converts typed wikilinks into clickable internal links on Enter/Space
 */

const wikilinkPluginKey = new PluginKey("wikilink");

// Regex to find [[target]] or [[target|alias]] in text nodes
const WIKILINK_RE = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

export interface WikilinkOptions {
  onNavigate?: (title: string) => void;
}

export const WikilinkExtension = Extension.create<WikilinkOptions>({
  name: "wikilink",

  addOptions() {
    return {
      onNavigate: undefined,
    };
  },

  addProseMirrorPlugins() {
    const onNavigate = this.options.onNavigate;

    return [
      new Plugin({
        key: wikilinkPluginKey,
        props: {
          decorations(state) {
            const { doc } = state;
            const decorations: Decoration[] = [];

            doc.descendants((node, pos) => {
              if (!node.isText || !node.text) return;

              let match: RegExpExecArray | null;
              WIKILINK_RE.lastIndex = 0;
              while ((match = WIKILINK_RE.exec(node.text)) !== null) {
                const start = pos + match.index;
                const end = start + match[0].length;
                decorations.push(
                  Decoration.inline(start, end, {
                    class: "wikilink-decoration",
                    "data-wikilink-target": match[1],
                    "data-wikilink-alias": match[2] || "",
                  })
                );
              }

              return false; // don't descend into text nodes
            });

            return DecorationSet.create(doc, decorations);
          },

          handleClick(view, pos, event) {
            const target = event.target as HTMLElement;
            if (!target.classList?.contains("wikilink-decoration")) return false;

            const title = target.getAttribute("data-wikilink-target");
            if (title && onNavigate) {
              onNavigate(title);
              return true;
            }
            return false;
          },
        },
      }),
    ];
  },
});
