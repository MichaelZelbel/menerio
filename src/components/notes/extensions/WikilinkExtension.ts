import { Node, mergeAttributes } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { ReactNodeViewRenderer } from "@tiptap/react";

/**
 * WikiLink inline node for Tiptap.
 * Stores a linked note's ID and title as attributes.
 * Renders as a styled clickable element.
 */

export interface WikilinkOptions {
  onNavigate?: (noteId: string) => void;
  onOpenAutocomplete?: (pos: number) => void;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    wikilink: {
      insertWikilink: (attrs: { noteId: string; noteTitle: string; displayText?: string }) => ReturnType;
    };
  }
}

export const WikilinkExtension = Node.create<WikilinkOptions>({
  name: "wikilink",
  group: "inline",
  inline: true,
  atom: true,

  addOptions() {
    return {
      onNavigate: undefined,
      onOpenAutocomplete: undefined,
    };
  },

  addAttributes() {
    return {
      noteId: { default: null },
      noteTitle: { default: "" },
      displayText: { default: "" },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-wikilink]',
        getAttrs: (el) => {
          const element = el as HTMLElement;
          return {
            noteId: element.getAttribute("data-note-id"),
            noteTitle: element.getAttribute("data-note-title"),
            displayText: element.getAttribute("data-display-text") || "",
          };
        },
      },
    ];
  },

  renderHTML({ node }) {
    const display = node.attrs.displayText || node.attrs.noteTitle;
    return [
      "span",
      mergeAttributes({
        "data-wikilink": "true",
        "data-note-id": node.attrs.noteId,
        "data-note-title": node.attrs.noteTitle,
        "data-display-text": node.attrs.displayText || "",
        class: "wikilink-node",
        contenteditable: "false",
      }),
      `[[${display}]]`,
    ];
  },

  addCommands() {
    return {
      insertWikilink:
        (attrs) =>
        ({ chain }) => {
          return chain()
            .insertContent({
              type: this.name,
              attrs,
            })
            .run();
        },
    };
  },

  addProseMirrorPlugins() {
    const extension = this;

    return [
      new Plugin({
        key: new PluginKey("wikilinkInput"),
        props: {
          handleTextInput(view, from, to, text) {
            // Detect [[ typing
            if (text === "[") {
              const { state } = view;
              const before = state.doc.textBetween(Math.max(0, from - 1), from);
              if (before === "[") {
                // Delete the first [ and trigger autocomplete
                const tr = state.tr.delete(from - 1, from);
                view.dispatch(tr);
                extension.options.onOpenAutocomplete?.(from - 1);
                return true;
              }
            }
            return false;
          },

          handleClick(view, pos, event) {
            const target = event.target as HTMLElement;
            const wikilinkEl = target.closest?.(".wikilink-node");
            if (wikilinkEl) {
              const noteId = wikilinkEl.getAttribute("data-note-id");
              if (noteId && extension.options.onNavigate) {
                extension.options.onNavigate(noteId);
                return true;
              }
            }
            return false;
          },
        },
      }),
    ];
  },
});
