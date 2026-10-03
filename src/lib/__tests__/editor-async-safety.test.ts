import { afterEach, describe, expect, it, vi } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import { openSavedNoteTab, resolveEditorAttachments } from "../editor-async-safety";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}

const editors: Editor[] = [];
function makeEditor() {
  const editor = new Editor({
    extensions: [StarterKit, Image.extend({
      addAttributes() {
        return { ...this.parent?.(), "data-attachment-name": { default: null } };
      },
    })],
    content: '<p>Old note</p><img src="old.png" data-attachment-name="old.png">',
  });
  editors.push(editor);
  return editor;
}
afterEach(() => { for (const editor of editors.splice(0)) editor.destroy(); });

describe("attachment responses arriving after an edit", () => {
  it("preserves edited text and a newly inserted image after the editor blurs", async () => {
    const editor = makeEditor();
    const response = deferred<string>();
    const original = editor.getHTML();
    const resolving = resolveEditorAttachments(editor, () => response.promise, () => true);
    editor.commands.insertContentAt(1, "Latest text. ");
    editor.commands.insertContentAt(editor.state.doc.content.size, '<img src="new.png">');
    editor.commands.blur();
    const edited = editor.getHTML();
    response.resolve(original.replace('src="old.png"', 'src="signed.png"'));
    await resolving;
    expect(editor.getHTML()).toBe(edited);
    expect(editor.getHTML()).toContain("Latest text");
    expect(editor.getHTML()).toContain("new.png");
  });

  it("discards an older resolver after an external document replaces its snapshot", async () => {
    const editor = makeEditor();
    const response = deferred<string>();
    const resolving = resolveEditorAttachments(editor, () => response.promise, () => true);
    editor.commands.setContent("<p>New server revision</p>", { emitUpdate: false });
    response.resolve("<p>Old signed copy</p>");
    await resolving;
    expect(editor.getText()).toBe("New server revision");
  });

  it("still resolves media when the document has not changed", async () => {
    const editor = makeEditor();
    await resolveEditorAttachments(editor, async (html) => html.replace('src="old.png"', 'src="signed.png"'), () => true);
    expect(editor.getHTML()).toContain('src="signed.png"');
  });

  it("does not load results into a different note", async () => {
    const editor = makeEditor();
    const original = editor.getHTML();
    await resolveEditorAttachments(editor, async () => "<p>Old copy</p>", () => false);
    expect(editor.getHTML()).toBe(original);
  });
});

function fakeTab() {
  return { closed: false, opener: {}, location: { replace: vi.fn() }, close: vi.fn() };
}
describe("opening a note in another tab", () => {
  it("reserves the tab synchronously and waits for text, image and title persistence", async () => {
    const saving = deferred<void>();
    const tab = fakeTab();
    const open = vi.fn(() => tab as unknown as Window);
    const opening = openSavedNoteTab("/dashboard/notes/example", () => saving.promise, open);
    expect(open).toHaveBeenCalledOnce();
    expect(tab.location.replace).not.toHaveBeenCalled();
    saving.resolve();
    expect(await opening).toBe(true);
    expect(tab.location.replace).toHaveBeenCalledWith("/dashboard/notes/example");
    expect(tab.opener).toBeNull();
  });

  it("keeps the existing note open and closes the blank tab when saving fails", async () => {
    const tab = fakeTab();
    await expect(openSavedNoteTab("/note", async () => { throw new Error("Save refused"); }, () => tab as unknown as Window)).rejects.toThrow("Save refused");
    expect(tab.close).toHaveBeenCalledOnce();
    expect(tab.location.replace).not.toHaveBeenCalled();
  });

  it("closes the reserved tab on a stalled save instead of loading an old copy", async () => {
    vi.useFakeTimers();
    try {
      const tab = fakeTab();
      const opening = openSavedNoteTab("/note", () => new Promise(() => {}), () => tab as unknown as Window, 15000);
      const rejected = expect(opening).rejects.toThrow("still saving");
      await vi.advanceTimersByTimeAsync(15000);
      await rejected;
      expect(tab.close).toHaveBeenCalledOnce();
      expect(tab.location.replace).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not start saving if the browser blocks the new tab", async () => {
    const save = vi.fn();
    await expect(openSavedNoteTab("/note", save, () => null)).rejects.toThrow("allow new tabs");
    expect(save).not.toHaveBeenCalled();
  });
});
