import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";

/**
 * Watches for typed Markdown task syntax (`- [ ] ` or `- [x] `) at the start
 * of a paragraph and converts that line into a real TipTap taskList/taskItem.
 *
 * This makes the editor behave like Obsidian/Evernote: the moment the user
 * finishes typing the syntax, the line turns into a clickable checkbox item.
 */
export const TaskListShortcut = Extension.create({
  name: "taskListShortcut",

  addProseMirrorPlugins() {
    const editor = this.editor;

    return [
      new Plugin({
        key: new PluginKey("taskListShortcut"),
        props: {
          handleTextInput(view, from, _to, text) {
            // We only care about the trailing space that completes "- [ ] " / "- [x] "
            if (text !== " ") return false;

            const { state } = view;
            const $from = state.doc.resolve(from);

            // Only trigger inside a paragraph (not already inside a task list)
            const parent = $from.parent;
            if (parent.type.name !== "paragraph") return false;

            // Read the text from the start of the paragraph up to the caret
            const start = $from.start();
            const before = state.doc.textBetween(start, from, "\n", "\n");

            // Match "- [ ]" or "- [x]" / "- [X]" with no leading content beyond optional whitespace
            const match = before.match(/^\s*-\s\[([ xX])\]$/);
            if (!match) return false;

            const checked = match[1].toLowerCase() === "x";

            // Use a microtask so the space is not actually inserted (we replace the line)
            queueMicrotask(() => {
              editor
                .chain()
                .focus()
                .command(({ tr, state: s }) => {
                  // Delete the matched syntax range from start of paragraph to caret
                  tr.delete(start, from);
                  return true;
                })
                .toggleTaskList()
                .updateAttributes("taskItem", { checked })
                .run();
            });

            // Swallow the space character; the chain above replaces the content.
            return true;
          },
        },
      }),
    ];
  },
});
