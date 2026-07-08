import { Editor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { NodeSelection } from "@tiptap/pm/state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  ArrowLeft,
  Bold,
  Code,
  FileText,
  Highlighter,
  Italic,
  Link,
  Strikethrough,
  Underline,
  Unlink,
} from "lucide-react";
import { useState } from "react";
import { TEXT_COLORS, ToolbarButton } from "./EditorToolbarGroups";

/**
 * Notion-style floating menu shown over a text selection. Everything renders
 * inline inside the menu element — deliberately NO portaled dropdowns or
 * popovers in here, because the bubble-menu plugin hides on focus/pointer
 * activity outside its element and portaled content lives in document.body.
 * Link editing and color picking are inline "modes" of the same row instead.
 */
export function EditorBubbleMenu({
  editor,
  onInsertWikilink,
}: {
  editor: Editor;
  onInsertWikilink?: () => void;
}) {
  const [mode, setMode] = useState<"buttons" | "link" | "color">("buttons");
  const [linkUrl, setLinkUrl] = useState("");

  const applyLink = () => {
    if (!linkUrl.trim()) {
      editor.chain().focus().unsetLink().run();
    } else {
      const url = linkUrl.startsWith("http") ? linkUrl : `https://${linkUrl}`;
      editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
    }
    setLinkUrl("");
    setMode("buttons");
  };

  return (
    <BubbleMenu
      editor={editor}
      pluginKey="textSelectionBubbleMenu"
      updateDelay={150}
      options={{
        placement: "top-start",
        offset: 6,
        // Selection gone → menu hides; make sure it reopens in buttons mode.
        onHide: () => setMode("buttons"),
      }}
      shouldShow={({ editor: e, state }) => {
        const { empty, from, to } = state.selection;
        if (empty || !e.isEditable) return false;
        // Inline marks don't apply inside code blocks, and node selections
        // (images, embeds, hr) have nothing for this menu to format.
        if (e.isActive("codeBlock")) return false;
        if (state.selection instanceof NodeSelection) return false;
        return state.doc.textBetween(from, to).trim().length > 0;
      }}
      className="z-50 flex items-center gap-0.5 rounded-md border border-border bg-popover p-1 shadow-md"
    >
      {mode === "link" && (
        <div className="flex items-center gap-1">
          <ToolbarButton onClick={() => setMode("buttons")} title="Back">
            <ArrowLeft className="h-3.5 w-3.5" />
          </ToolbarButton>
          <Input
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            placeholder="https://..."
            className="h-7 w-52 text-sm"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                applyLink();
              }
              if (e.key === "Escape") setMode("buttons");
            }}
            autoFocus
          />
          <Button size="sm" className="h-7" onClick={applyLink}>
            Apply
          </Button>
        </div>
      )}

      {mode === "color" && (
        <div className="flex items-center gap-1">
          <ToolbarButton onClick={() => setMode("buttons")} title="Back">
            <ArrowLeft className="h-3.5 w-3.5" />
          </ToolbarButton>
          {TEXT_COLORS.map((c) => (
            <button
              key={c.value}
              type="button"
              title={c.label}
              className="flex h-6 w-6 items-center justify-center rounded hover:bg-accent"
              onClick={() => {
                if (c.value === "inherit") {
                  editor.chain().focus().unsetColor().run();
                } else {
                  editor.chain().focus().setColor(c.value).run();
                }
                setMode("buttons");
              }}
            >
              <span
                className="inline-block h-3.5 w-3.5 rounded-full border border-border"
                style={{ backgroundColor: c.value === "inherit" ? "currentColor" : c.value }}
              />
            </button>
          ))}
        </div>
      )}

      {mode === "buttons" && (
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
          <ToolbarButton onClick={() => editor.chain().focus().toggleCode().run()} active={editor.isActive("code")} title="Inline code">
            <Code className="h-3.5 w-3.5" />
          </ToolbarButton>
          <ToolbarButton onClick={() => editor.chain().focus().toggleHighlight().run()} active={editor.isActive("highlight")} title="Highlight">
            <Highlighter className="h-3.5 w-3.5" />
          </ToolbarButton>

          <Separator orientation="vertical" className="mx-0.5 h-5" />

          <ToolbarButton onClick={() => setMode("color")} title="Text color">
            <span
              className="text-xs font-bold"
              style={{ color: editor.getAttributes("textStyle").color || "inherit" }}
            >
              A
            </span>
          </ToolbarButton>
          <ToolbarButton
            onClick={() => {
              setLinkUrl(editor.getAttributes("link").href || "");
              setMode("link");
            }}
            active={editor.isActive("link")}
            title="Insert link"
          >
            <Link className="h-3.5 w-3.5" />
          </ToolbarButton>
          {editor.isActive("link") && (
            <ToolbarButton onClick={() => editor.chain().focus().unsetLink().run()} title="Remove link">
              <Unlink className="h-3.5 w-3.5" />
            </ToolbarButton>
          )}
          {onInsertWikilink && (
            <ToolbarButton
              onClick={() => {
                editor.chain().focus().run();
                onInsertWikilink();
              }}
              title="Link to note"
            >
              <FileText className="h-3.5 w-3.5" />
            </ToolbarButton>
          )}
        </>
      )}
    </BubbleMenu>
  );
}
