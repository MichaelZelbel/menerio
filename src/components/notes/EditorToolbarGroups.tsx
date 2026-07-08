import { Editor } from "@tiptap/react";
import { Button } from "@/components/ui/button";
import { EmbedToolbar } from "./EmbedToolbar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  ChevronDown,
  Code,
  FileText,
  Heading1,
  Heading2,
  Heading3,
  Highlighter,
  Italic,
  Link,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  Pilcrow,
  Quote,
  Redo,
  RemoveFormatting,
  Strikethrough,
  Subscript,
  Superscript,
  Table,
  Type,
  Underline,
  Undo,
  Unlink,
} from "lucide-react";
import { useState } from "react";
import type { ToolbarGroupId } from "./toolbarLayout";

export const TEXT_COLORS = [
  { label: "Default", value: "inherit" },
  { label: "Red", value: "hsl(0, 72%, 51%)" },
  { label: "Orange", value: "hsl(25, 95%, 53%)" },
  { label: "Yellow", value: "hsl(45, 93%, 47%)" },
  { label: "Green", value: "hsl(142, 71%, 45%)" },
  { label: "Blue", value: "hsl(217, 91%, 60%)" },
  { label: "Purple", value: "hsl(263, 70%, 50%)" },
  { label: "Pink", value: "hsl(330, 81%, 60%)" },
  { label: "Gray", value: "hsl(220, 9%, 46%)" },
];

export function ToolbarButton({
  onClick,
  active,
  disabled,
  title,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={`h-7 w-7 ${active ? "bg-accent text-accent-foreground" : ""}`}
      onClick={onClick}
      disabled={disabled}
      title={title}
    >
      {children}
    </Button>
  );
}

interface GroupProps {
  editor: Editor;
}

export function HistoryGroup({ editor }: GroupProps) {
  return (
    <>
      <ToolbarButton onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()} title="Undo (Ctrl+Z)">
        <Undo className="h-3.5 w-3.5" />
      </ToolbarButton>
      <ToolbarButton onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()} title="Redo (Ctrl+Shift+Z)">
        <Redo className="h-3.5 w-3.5" />
      </ToolbarButton>
    </>
  );
}

export function BlockTypeGroup({ editor }: GroupProps) {
  const currentHeading = editor.isActive("heading", { level: 1 })
    ? "Heading 1"
    : editor.isActive("heading", { level: 2 })
    ? "Heading 2"
    : editor.isActive("heading", { level: 3 })
    ? "Heading 3"
    : "Normal text";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {/* Fixed width so the toolbar's Priority+ math stays exact and the row
            doesn't jitter when the caret moves between heading levels. */}
        <Button variant="ghost" size="sm" className="h-7 w-28 justify-between gap-1 text-xs font-normal px-2">
          <span className="flex items-center gap-1 truncate">
            <Pilcrow className="h-3.5 w-3.5 shrink-0" />
            {currentHeading}
          </span>
          <ChevronDown className="h-3 w-3 shrink-0" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem onClick={() => editor.chain().focus().setParagraph().run()}>
          <Type className="mr-2 h-4 w-4" /> Normal text
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}>
          <Heading1 className="mr-2 h-4 w-4" /> Heading 1
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>
          <Heading2 className="mr-2 h-4 w-4" /> Heading 2
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>
          <Heading3 className="mr-2 h-4 w-4" /> Heading 3
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function CoreMarksGroup({ editor }: GroupProps) {
  return (
    <>
      <ToolbarButton onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive("bold")} title="Bold (Ctrl+B)">
        <Bold className="h-3.5 w-3.5" />
      </ToolbarButton>
      <ToolbarButton onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive("italic")} title="Italic (Ctrl+I)">
        <Italic className="h-3.5 w-3.5" />
      </ToolbarButton>
      <ToolbarButton onClick={() => editor.chain().focus().toggleUnderline().run()} active={editor.isActive("underline")} title="Underline (Ctrl+U)">
        <Underline className="h-3.5 w-3.5" />
      </ToolbarButton>
      <ToolbarButton onClick={() => editor.chain().focus().toggleStrike().run()} active={editor.isActive("strike")} title="Strikethrough">
        <Strikethrough className="h-3.5 w-3.5" />
      </ToolbarButton>
    </>
  );
}

export function ExtendedMarksGroup({ editor }: GroupProps) {
  return (
    <>
      <ToolbarButton onClick={() => editor.chain().focus().toggleCode().run()} active={editor.isActive("code")} title="Inline code">
        <Code className="h-3.5 w-3.5" />
      </ToolbarButton>
      <ToolbarButton onClick={() => editor.chain().focus().toggleHighlight().run()} active={editor.isActive("highlight")} title="Highlight">
        <Highlighter className="h-3.5 w-3.5" />
      </ToolbarButton>
      <ToolbarButton onClick={() => editor.chain().focus().toggleSuperscript().run()} active={editor.isActive("superscript")} title="Superscript">
        <Superscript className="h-3.5 w-3.5" />
      </ToolbarButton>
      <ToolbarButton onClick={() => editor.chain().focus().toggleSubscript().run()} active={editor.isActive("subscript")} title="Subscript">
        <Subscript className="h-3.5 w-3.5" />
      </ToolbarButton>
    </>
  );
}

export function ColorGroup({ editor }: GroupProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-7 w-7" title="Text color">
          <span className="text-xs font-bold" style={{ color: editor.getAttributes("textStyle").color || "inherit" }}>A</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {TEXT_COLORS.map((c) => (
          <DropdownMenuItem
            key={c.value}
            onClick={() =>
              c.value === "inherit"
                ? editor.chain().focus().unsetColor().run()
                : editor.chain().focus().setColor(c.value).run()
            }
          >
            <span className="mr-2 h-3 w-3 rounded-full inline-block border border-border" style={{ backgroundColor: c.value === "inherit" ? "currentColor" : c.value }} />
            {c.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ListsGroup({ editor }: GroupProps) {
  return (
    <>
      <ToolbarButton onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive("bulletList")} title="Bullet list">
        <List className="h-3.5 w-3.5" />
      </ToolbarButton>
      <ToolbarButton onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive("orderedList")} title="Numbered list">
        <ListOrdered className="h-3.5 w-3.5" />
      </ToolbarButton>
      <ToolbarButton onClick={() => editor.chain().focus().toggleTaskList().run()} active={editor.isActive("taskList")} title="Checklist">
        <ListChecks className="h-3.5 w-3.5" />
      </ToolbarButton>
    </>
  );
}

export function BlockFormatGroup({ editor }: GroupProps) {
  return (
    <>
      <ToolbarButton onClick={() => editor.chain().focus().toggleBlockquote().run()} active={editor.isActive("blockquote")} title="Quote">
        <Quote className="h-3.5 w-3.5" />
      </ToolbarButton>
      <ToolbarButton onClick={() => editor.chain().focus().setHorizontalRule().run()} title="Horizontal rule">
        <Minus className="h-3.5 w-3.5" />
      </ToolbarButton>
      <ToolbarButton onClick={() => editor.chain().focus().toggleCodeBlock().run()} active={editor.isActive("codeBlock")} title="Code block">
        <Code className="h-3.5 w-3.5" />
      </ToolbarButton>
    </>
  );
}

export function AlignGroup({ editor }: GroupProps) {
  return (
    <>
      <ToolbarButton onClick={() => editor.chain().focus().setTextAlign("left").run()} active={editor.getAttributes("paragraph").textAlign === "left" || !editor.getAttributes("paragraph").textAlign} title="Align left">
        <AlignLeft className="h-3.5 w-3.5" />
      </ToolbarButton>
      <ToolbarButton onClick={() => editor.chain().focus().setTextAlign("center").run()} active={editor.getAttributes("paragraph").textAlign === "center"} title="Align center">
        <AlignCenter className="h-3.5 w-3.5" />
      </ToolbarButton>
      <ToolbarButton onClick={() => editor.chain().focus().setTextAlign("right").run()} active={editor.getAttributes("paragraph").textAlign === "right"} title="Align right">
        <AlignRight className="h-3.5 w-3.5" />
      </ToolbarButton>
      <ToolbarButton onClick={() => editor.chain().focus().setTextAlign("justify").run()} active={editor.getAttributes("paragraph").textAlign === "justify"} title="Justify">
        <AlignJustify className="h-3.5 w-3.5" />
      </ToolbarButton>
    </>
  );
}

export function InsertGroup({
  editor,
  onInsertWikilink,
}: GroupProps & { onInsertWikilink?: () => void }) {
  const [linkUrl, setLinkUrl] = useState("");
  const [linkOpen, setLinkOpen] = useState(false);

  const setLink = () => {
    if (!linkUrl.trim()) {
      editor.chain().focus().unsetLink().run();
    } else {
      const url = linkUrl.startsWith("http") ? linkUrl : `https://${linkUrl}`;
      editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
    }
    setLinkUrl("");
    setLinkOpen(false);
  };

  return (
    <>
      <Popover open={linkOpen} onOpenChange={setLinkOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className={`h-7 w-7 ${editor.isActive("link") ? "bg-accent text-accent-foreground" : ""}`}
            title="Insert link"
            onClick={() => {
              const existing = editor.getAttributes("link").href || "";
              setLinkUrl(existing);
              setLinkOpen(true);
            }}
          >
            <Link className="h-3.5 w-3.5" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-3" align="start">
          <div className="flex gap-2">
            <Input
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              placeholder="https://..."
              className="h-8 text-sm"
              onKeyDown={(e) => e.key === "Enter" && setLink()}
              autoFocus
            />
            <Button size="sm" className="h-8" onClick={setLink}>
              Apply
            </Button>
          </div>
        </PopoverContent>
      </Popover>
      {editor.isActive("link") && (
        <ToolbarButton onClick={() => editor.chain().focus().unsetLink().run()} title="Remove link">
          <Unlink className="h-3.5 w-3.5" />
        </ToolbarButton>
      )}

      {/* Link to another note (wikilink) */}
      {onInsertWikilink && (
        <ToolbarButton
          onClick={() => {
            editor.chain().focus().run();
            onInsertWikilink();
          }}
          title="Link to note (or type [[)"
        >
          <FileText className="h-3.5 w-3.5" />
        </ToolbarButton>
      )}

      {/* Table */}
      <ToolbarButton
        onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
        title="Insert table"
      >
        <Table className="h-3.5 w-3.5" />
      </ToolbarButton>

      {/* Media embeds */}
      <EmbedToolbar editor={editor} />
    </>
  );
}

export function ClearGroup({ editor }: GroupProps) {
  return (
    <ToolbarButton onClick={() => editor.chain().focus().clearNodes().unsetAllMarks().run()} title="Clear formatting">
      <RemoveFormatting className="h-3.5 w-3.5" />
    </ToolbarButton>
  );
}

/**
 * Whether a group has visibly "active" state, used to light up the overflow
 * trigger when the group is collapsed. Left-alignment is the default and
 * deliberately doesn't count.
 */
export const GROUP_IS_ACTIVE: Record<ToolbarGroupId, (editor: Editor) => boolean> = {
  history: () => false,
  blockType: (editor) =>
    editor.isActive("heading", { level: 1 }) ||
    editor.isActive("heading", { level: 2 }) ||
    editor.isActive("heading", { level: 3 }),
  coreMarks: (editor) =>
    editor.isActive("bold") ||
    editor.isActive("italic") ||
    editor.isActive("underline") ||
    editor.isActive("strike"),
  extendedMarks: (editor) =>
    editor.isActive("code") ||
    editor.isActive("highlight") ||
    editor.isActive("superscript") ||
    editor.isActive("subscript"),
  color: (editor) => !!editor.getAttributes("textStyle").color,
  lists: (editor) =>
    editor.isActive("bulletList") ||
    editor.isActive("orderedList") ||
    editor.isActive("taskList"),
  blockFormat: (editor) =>
    editor.isActive("blockquote") || editor.isActive("codeBlock"),
  align: (editor) => {
    const align = editor.getAttributes("paragraph").textAlign;
    return align === "center" || align === "right" || align === "justify";
  },
  insert: (editor) => editor.isActive("link"),
  clear: () => false,
};
