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
  onInternalNavigate?: (path: string) => void;
}

const INTERNAL_APP_HOSTS = ["menerio.com", "www.menerio.com", "menerio.lovable.app"];

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
  onInternalNavigate,
}: RichTextEditorProps) {
  const toWikiSlug = (value: string) =>
    value
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, "&")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");

  const toEditorHtml = (markdown: string) => {
    let html = markdownToHtml(markdown).replace(
      /<span[^>]*data-wikilink="true"[^>]*>[\s\S]*?<\/span>/gi,
      (match) => {
        const target = match.match(/data-note-title="([^"]*)"/i)?.[1] || "";
        const display = match.match(/data-display-text="([^"]*)"/i)?.[1] || "";
        const slug = toWikiSlug(target);
        const label = (display || target).replace(/&quot;/g, '"').replace(/&amp;/g, "&").trim() || slug;
        return `<a class="wiki-link" data-slug="${slug}" href="/lexicon/${slug}">${label}</a>`;
      },
    );
    // Defensively strip target="_blank" from anchors that resolve to internal hosts,
    // so historical content doesn't force a new-tab open before our click handler runs.
    html = html.replace(/<a\b([^>]*)>/gi, (full, attrs: string) => {
      const hrefMatch = attrs.match(/href\s*=\s*"([^"]*)"/i);
      if (!hrefMatch) return full;
      const href = hrefMatch[1];
      if (!href || href.startsWith("#")) return full;
      if (!/^(https?:)?\/\//i.test(href) && !href.startsWith("/")) return full;
      let url: URL;
      try {
        url = new URL(href, window.location.href);
      } catch {
        return full;
      }
      const isInternal =
        url.host === window.location.host ||
        INTERNAL_APP_HOSTS.includes(url.host) ||
        url.host.endsWith(".lovable.app");
      if (!isInternal) return full;
      const cleaned = attrs.replace(/\s+target\s*=\s*"[^"]*"/gi, "");
      return `<a${cleaned}>`;
    });
    return html;
  };

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] }, codeBlock: false, link: false, underline: false }),
      UnderlineExt,
      LinkExt.configure({ openOnClick: false, HTMLAttributes: { rel: "noopener noreferrer", target: null } }),
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
    if (editor.isFocused) return;
    const current = editorToMarkdown(editor);
    if (current.trimEnd() !== value.trimEnd()) {
      editor.commands.setContent(toEditorHtml(value), { emitUpdate: false });
    }
  }, [editor, value]);

  const handleContainerClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    const wikiLink = target.closest?.(".wiki-link") as HTMLAnchorElement | null;
    if (wikiLink) {
      // Internal Lexicon link: never open a new browser window. Allow modifier
      // keys / middle-click to behave normally so users can still force a new
      // tab if they want to.
      if (event.defaultPrevented) return;
      if (event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const slug = wikiLink.getAttribute("data-slug");
      if (!slug) return;
      event.preventDefault();
      onWikiLinkClick?.(slug, wikiLink);
      return;
    }
    // Generic anchor: distinguish same-origin (internal) vs cross-origin (external).
    const anchor = target.closest?.("a[href]") as HTMLAnchorElement | null;
    if (!anchor) return;
    const href = anchor.getAttribute("href") || "";
    if (!href || href.startsWith("#")) return;
    // Skip non-http(s) schemes (mailto:, tel:, data:, attachment-link with href="#", etc.)
    if (!/^(https?:)?\/\//i.test(href) && !href.startsWith("/")) return;
    let url: URL;
    try {
      url = new URL(href, window.location.href);
    } catch {
      return;
    }
    const isInternalHost =
      url.host === window.location.host ||
      INTERNAL_APP_HOSTS.includes(url.host) ||
      url.host.endsWith(".lovable.app");
    if (isInternalHost) {
      // Internal link: stay in the same window, prefer SPA navigation.
      anchor.removeAttribute("target");
      if (event.defaultPrevented) return;
      if (event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      const path = url.pathname + url.search + url.hash;
      if (onInternalNavigate) {
        onInternalNavigate(path);
      } else {
        window.location.assign(path);
      }
    } else {
      // External link: open in a new tab with safe rel.
      if (!anchor.getAttribute("target")) anchor.setAttribute("target", "_blank");
      if (!anchor.getAttribute("rel")) anchor.setAttribute("rel", "noreferrer noopener");
    }
  };

  return (
    <div className={cn("overflow-hidden rounded-md border border-border bg-background", className)}>
      {showToolbar && <EditorToolbar editor={editor} />}
      <div className="p-4" onClickCapture={handleContainerClick}>
        <EditorContent editor={editor} className="tiptap-editor" />
      </div>
    </div>
  );
}