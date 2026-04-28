import { useEffect } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
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
import { Markdown } from "tiptap-markdown";
import { EditorToolbar } from "@/components/notes/EditorToolbar";
import { AudioEmbed } from "@/components/notes/extensions/AudioEmbed";
import { PdfEmbed } from "@/components/notes/extensions/PdfEmbed";
import { TaskListShortcut } from "@/components/notes/extensions/TaskListShortcut";
import { VideoEmbed } from "@/components/notes/extensions/VideoEmbed";
import { markdownToHtml, tiptapJsonToMarkdown } from "@/utils/markdown-converter";
import { WikiLinkMark } from "@/components/editor/WikiLinkMark";
import { cn } from "@/lib/utils";

interface RichTextEditorProps {
  value: string;
  editable?: boolean;
  placeholder?: string;
  showToolbar?: boolean;
  className?: string;
  onChange?: (markdown: string, editor: Editor) => void;
  onEditorReady?: (editor: Editor | null) => void;
  onWikiLinkClick?: (slug: string, element: HTMLElement) => void;
}

export function editorToMarkdown(editor: Pick<Editor, "getJSON">): string {
  return tiptapJsonToMarkdown(editor.getJSON()).trimEnd();
}

export function RichTextEditor({
  value,
  editable = false,
  placeholder = "Start writing…",
  showToolbar = editable,
  className,
  onChange,
  onEditorReady,
  onWikiLinkClick,
}: RichTextEditorProps) {
  const toWikiSlug = (value: string) =>
    value
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, "&")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");

  const toEditorHtml = (markdown: string) =>
    markdownToHtml(markdown).replace(
      /<span[^>]*data-wikilink="true"[^>]*>[\s\S]*?<\/span>/gi,
      (match) => {
        const target = match.match(/data-note-title="([^"]*)"/i)?.[1] || "";
        const display = match.match(/data-display-text="([^"]*)"/i)?.[1] || "";
        const slug = toWikiSlug(target);
        const label = (display || target).replace(/&quot;/g, '"').replace(/&amp;/g, "&").trim() || slug;
        return `<a class="wiki-link" data-slug="${slug}" href="/lexicon/${slug}">${label}</a>`;
      },
    );

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] }, codeBlock: false, link: false, underline: false }),
      UnderlineExt,
      LinkExt.configure({ openOnClick: false }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Highlight.configure({ multicolor: true }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder }),
      TextStyle,
      Color,
      ImageExt,
      SuperscriptExt,
      SubscriptExt,
      TableExt.configure({ resizable: true }),
      TableRow,
      TableCell,
      TableHeader,
      VideoEmbed,
      PdfEmbed,
      AudioEmbed,
      WikiLinkMark,
      Markdown.configure({ html: true, transformPastedText: true, transformCopiedText: false }),
      TaskListShortcut,
    ],
    content: toEditorHtml(value),
    editable,
    editorProps: {
      handleClick: (_view, _pos, event) => {
        const target = event.target as HTMLElement;
        const link = target.closest?.(".wiki-link") as HTMLElement | null;
        const slug = link?.getAttribute("data-slug");
        if (!link || !slug) return false;
        event.preventDefault();
        onWikiLinkClick?.(slug, link);
        return true;
      },
    },
    onUpdate: ({ editor: updatedEditor }) => onChange?.(editorToMarkdown(updatedEditor), updatedEditor),
  });

  useEffect(() => {
    onEditorReady?.(editor);
    return () => onEditorReady?.(null);
  }, [editor, onEditorReady]);

  useEffect(() => {
    editor?.setEditable(editable);
  }, [editor, editable]);

  useEffect(() => {
    if (!editor) return;
    const current = editorToMarkdown(editor);
    if (current.trimEnd() !== value.trimEnd()) {
      editor.commands.setContent(toEditorHtml(value), { emitUpdate: false });
    }
  }, [editor, value]);

  return (
    <div className={cn("overflow-hidden rounded-md border border-border bg-background", className)}>
      {showToolbar && <EditorToolbar editor={editor} />}
      <div className="p-4">
        <EditorContent editor={editor} className="tiptap-editor" />
      </div>
    </div>
  );
}