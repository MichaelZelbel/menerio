import type { Editor } from "@tiptap/core";

/** Resolving media must never restore the document from before a user edit. */
export async function resolveEditorAttachments(
  editor: Editor,
  resolve: (html: string) => Promise<string>,
  isCurrent: () => boolean,
): Promise<void> {
  const doc = editor.state.doc;
  const html = editor.getHTML();
  if (!html.includes("data-attachment-name=")) return;
  const resolved = await resolve(html);
  // Document identity catches editing, undo and external loads, including
  // changes made while the resolver waits and the editor subsequently blurs.
  if (editor.isDestroyed || editor.isFocused || !isCurrent() || editor.state.doc !== doc) return;
  if (resolved !== html) editor.commands.setContent(resolved, { emitUpdate: false });
}

/** Reserve the tab during the click, but load the note only after saving. */
export async function openSavedNoteTab(
  url: string,
  save: () => Promise<void>,
  open: () => Window | null = () => window.open("about:blank", "_blank"),
  timeoutMs = 15000,
): Promise<boolean> {
  const tab = open();
  if (!tab) throw new Error("Please allow new tabs to open this note.");
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([save(), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("The note is still saving. Please try again.")), timeoutMs);
    })]);
    if (tab.closed) return false;
    tab.opener = null;
    tab.location.replace(url);
    return true;
  } catch (error) {
    tab.close();
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
