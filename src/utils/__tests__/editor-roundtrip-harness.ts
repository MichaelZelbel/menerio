/**
 * Test harness: load Markdown into a real TipTap editor configured like the
 * note editor, then save it back to Markdown, exactly as NoteEditor does
 * (normalizeNoteContent -> looksLikeHtml ? html : markdownToHtml -> editor ->
 * tiptapJsonToMarkdown). FileUploadHandler is left out: it only handles paste
 * and drop and talks to Supabase.
 */
import { Editor, type AnyExtension } from "@tiptap/core";
import { Markdown } from "tiptap-markdown";
import StarterKit from "@tiptap/starter-kit";
import UnderlineExt from "@tiptap/extension-underline";
import LinkExt from "@tiptap/extension-link";
import TextAlign from "@tiptap/extension-text-align";
import Highlight from "@tiptap/extension-highlight";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Placeholder from "@tiptap/extension-placeholder";
import { TextStyle } from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import ImageExt from "@tiptap/extension-image";
import SuperscriptExt from "@tiptap/extension-superscript";
import SubscriptExt from "@tiptap/extension-subscript";
import { Table as TableExt } from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import { VideoEmbed } from "@/components/notes/extensions/VideoEmbed";
import { PdfEmbed } from "@/components/notes/extensions/PdfEmbed";
import { AudioEmbed } from "@/components/notes/extensions/AudioEmbed";
import { WikilinkExtension } from "@/components/notes/extensions/WikilinkExtension";
import { TaskListShortcut } from "@/components/notes/extensions/TaskListShortcut";
import { looksLikeHtml, normalizeNoteContent } from "@/lib/note-content";
import { resolveWikilinksInHtml } from "@/lib/wikilink-resolver";
import { markdownToHtml, tiptapJsonToMarkdown } from "@/utils/markdown-converter";

export interface HarnessOptions {
  /** Mirror of StarterKit's `codeBlock` option in NoteEditor (false = disabled). */
  codeBlock?: boolean;
  /** NoteEditor resolves `[[Title]]` against the user's notes before loading. */
  titleMap?: Map<string, string>;
}

export function noteEditorExtensions({ codeBlock = true }: HarnessOptions = {}): AnyExtension[] {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      ...(codeBlock ? {} : { codeBlock: false as const }),
      link: false,
      underline: false,
    }),
    UnderlineExt,
    LinkExt.configure({ openOnClick: false }),
    TextAlign.configure({ types: ["heading", "paragraph"] }),
    Highlight.configure({ multicolor: true }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Placeholder.configure({ placeholder: "Start writing" }),
    TextStyle,
    Color,
    ImageExt.extend({
      addAttributes() {
        return {
          ...this.parent?.(),
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
    }),
    SuperscriptExt,
    SubscriptExt,
    TableExt.configure({ resizable: true }),
    TableRow,
    TableCell,
    TableHeader,
    VideoEmbed,
    PdfEmbed,
    AudioEmbed,
    Markdown.configure({ html: true, transformPastedText: true, transformCopiedText: false }),
    WikilinkExtension,
    TaskListShortcut,
  ];
}

/** NoteEditor's contentToEditorHtml, minus the external-note H1 strip. */
export function contentToEditorHtml(content: string): string {
  const normalized = normalizeNoteContent(content);
  return looksLikeHtml(normalized) ? normalized : markdownToHtml(normalized);
}

export function loadIntoEditor(md: string, options: HarnessOptions = {}): Editor {
  const html = contentToEditorHtml(md);
  const content = options.titleMap ? resolveWikilinksInHtml(html, options.titleMap) : html;
  return new Editor({ extensions: noteEditorExtensions(options), content });
}

export function editorToMarkdown(editor: Editor): string {
  return tiptapJsonToMarkdown(editor.getJSON()).trimEnd();
}

/** Markdown -> editor -> Markdown, the way a note is opened and autosaved. */
export function roundTrip(md: string, options?: HarnessOptions): string {
  const editor = loadIntoEditor(md, options);
  try {
    return editorToMarkdown(editor);
  } finally {
    editor.destroy();
  }
}
