import { Editor } from "@tiptap/react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import {
  Columns,
  EllipsisVertical,
  Merge,
  Plus,
  RowsIcon,
  SplitSquareHorizontal,
  TableProperties,
  Trash2,
} from "lucide-react";
import { Fragment, useEffect, useMemo, useState } from "react";
import {
  AlignGroup,
  BlockFormatGroup,
  BlockTypeGroup,
  ClearGroup,
  ColorGroup,
  CoreMarksGroup,
  ExtendedMarksGroup,
  GROUP_IS_ACTIVE,
  HistoryGroup,
  InsertGroup,
  ListsGroup,
  ToolbarButton,
} from "./EditorToolbarGroups";
import {
  DISPLAY_ORDER,
  computeCollapsedGroups,
  type ToolbarGroupId,
} from "./toolbarLayout";
import { useElementWidth } from "@/hooks/useElementWidth";

interface EditorToolbarProps {
  editor: Editor | null;
  /** Quick-action icon buttons rendered right before the overflow menu (e.g. Favorite, Pin, AI Chat). */
  quickActions?: React.ReactNode;
  /** Overflow / "more" menu rendered at the far right (typically a DropdownMenu trigger). */
  noteActions?: React.ReactNode;
  /** Triggered when the user clicks the "Link to note" button. Opens the wikilink autocomplete at the cursor. */
  onInsertWikilink?: () => void;
}

export function EditorToolbar({ editor, quickActions, noteActions, onInsertWikilink }: EditorToolbarProps) {
  // Force re-render on every editor transaction so reactive reads like
  // `editor.can().undo()`, `editor.can().redo()`, and `editor.isActive(...)`
  // reflect live state instead of being frozen at mount time (which kept
  // the Undo button perpetually disabled even after the user typed).
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!editor) return;
    const tick = () => setTick((n) => (n + 1) % 1_000_000);
    editor.on("transaction", tick);
    editor.on("selectionUpdate", tick);
    editor.on("update", tick);
    editor.on("focus", tick);
    editor.on("blur", tick);
    return () => {
      editor.off("transaction", tick);
      editor.off("selectionUpdate", tick);
      editor.off("update", tick);
      editor.off("focus", tick);
      editor.off("blur", tick);
    };
  }, [editor]);

  // Priority+ layout: the formatting region is flex-1, so its measured width
  // IS the space available for formatting groups; groups that don't fit
  // collapse into the "More formatting" popover instead of wrapping.
  const [formattingRef, formattingWidth] = useElementWidth<HTMLDivElement>();
  const hasWikilink = !!onInsertWikilink;
  const hasRemoveLink = editor?.isActive("link") ?? false;
  const collapsed = useMemo(
    () => computeCollapsedGroups(formattingWidth, { hasWikilink, hasRemoveLink }),
    [formattingWidth, hasWikilink, hasRemoveLink],
  );

  if (!editor) return null;

  const isInsideTable = editor.isActive("table");

  const renderGroup = (id: ToolbarGroupId) => {
    switch (id) {
      case "history":
        return <HistoryGroup editor={editor} />;
      case "blockType":
        return <BlockTypeGroup editor={editor} />;
      case "coreMarks":
        return <CoreMarksGroup editor={editor} />;
      case "extendedMarks":
        return <ExtendedMarksGroup editor={editor} />;
      case "color":
        return <ColorGroup editor={editor} />;
      case "lists":
        return <ListsGroup editor={editor} />;
      case "blockFormat":
        return <BlockFormatGroup editor={editor} />;
      case "align":
        return <AlignGroup editor={editor} />;
      case "insert":
        return <InsertGroup editor={editor} onInsertWikilink={onInsertWikilink} />;
      case "clear":
        return <ClearGroup editor={editor} />;
    }
  };

  const visibleGroups = DISPLAY_ORDER.filter((id) => !collapsed.has(id));
  const collapsedGroups = DISPLAY_ORDER.filter((id) => collapsed.has(id));
  const overflowActive = collapsedGroups.some((id) => GROUP_IS_ACTIVE[id](editor));

  return (
    <div className="shrink-0">
      <div className="flex items-center border-b border-border bg-background px-2 py-1">
        <div ref={formattingRef} className="flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden">
          {visibleGroups.map((id, i) => (
            <Fragment key={id}>
              {i > 0 && <Separator orientation="vertical" className="h-5 mx-1 shrink-0" />}
              <div className="flex shrink-0 items-center gap-0.5">{renderGroup(id)}</div>
            </Fragment>
          ))}

          {collapsedGroups.length > 0 && (
            <>
              {visibleGroups.length > 0 && <Separator orientation="vertical" className="h-5 mx-1 shrink-0" />}
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className={`relative h-7 w-7 shrink-0 ${overflowActive ? "bg-accent text-accent-foreground" : ""}`}
                    title="More formatting"
                    aria-label="More formatting"
                  >
                    <EllipsisVertical className="h-3.5 w-3.5" />
                    {overflowActive && (
                      <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-primary" />
                    )}
                  </Button>
                </PopoverTrigger>
                {/* Commands run editor.chain().focus(), which moves focus to the
                    editor — prevent focus-outside dismissal so the panel stays
                    open for applying several formats. Outside click and Escape
                    still close it. */}
                <PopoverContent
                  align="start"
                  className="w-auto p-2"
                  onFocusOutside={(e) => e.preventDefault()}
                >
                  <div className="flex flex-col gap-1">
                    {collapsedGroups.map((id) => (
                      <div key={id} className="flex items-center gap-0.5">
                        {renderGroup(id)}
                      </div>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
            </>
          )}
        </div>

        {(quickActions || noteActions) && (
          <>
            <Separator orientation="vertical" className="h-5 mx-1 shrink-0" />
            <div className="flex shrink-0 items-center gap-0.5">
              {quickActions}
              {noteActions}
            </div>
          </>
        )}
      </div>

      {/* Contextual table toolbar */}
      {isInsideTable && (
        <div className="flex items-center gap-0.5 px-2 py-1 border-b border-border bg-muted/50 flex-wrap">
          <span className="text-xs text-muted-foreground font-medium mr-1">Table:</span>

          {/* Row operations */}
          <ToolbarButton onClick={() => editor.chain().focus().addRowBefore().run()} title="Add row above">
            <Plus className="h-3 w-3" />
            <RowsIcon className="h-3 w-3" />
          </ToolbarButton>
          <ToolbarButton onClick={() => editor.chain().focus().addRowAfter().run()} title="Add row below">
            <RowsIcon className="h-3 w-3" />
            <Plus className="h-3 w-3" />
          </ToolbarButton>
          <ToolbarButton onClick={() => editor.chain().focus().deleteRow().run()} title="Delete row">
            <RowsIcon className="h-3 w-3 text-destructive" />
          </ToolbarButton>

          <Separator orientation="vertical" className="h-5 mx-1" />

          {/* Column operations */}
          <ToolbarButton onClick={() => editor.chain().focus().addColumnBefore().run()} title="Add column before">
            <Plus className="h-3 w-3" />
            <Columns className="h-3 w-3" />
          </ToolbarButton>
          <ToolbarButton onClick={() => editor.chain().focus().addColumnAfter().run()} title="Add column after">
            <Columns className="h-3 w-3" />
            <Plus className="h-3 w-3" />
          </ToolbarButton>
          <ToolbarButton onClick={() => editor.chain().focus().deleteColumn().run()} title="Delete column">
            <Columns className="h-3 w-3 text-destructive" />
          </ToolbarButton>

          <Separator orientation="vertical" className="h-5 mx-1" />

          {/* Cell operations */}
          <ToolbarButton onClick={() => editor.chain().focus().mergeCells().run()} title="Merge cells">
            <Merge className="h-3.5 w-3.5" />
          </ToolbarButton>
          <ToolbarButton onClick={() => editor.chain().focus().splitCell().run()} title="Split cell">
            <SplitSquareHorizontal className="h-3.5 w-3.5" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleHeaderRow().run()}
            active={editor.isActive("tableHeader")}
            title="Toggle header row"
          >
            <TableProperties className="h-3.5 w-3.5" />
          </ToolbarButton>

          <Separator orientation="vertical" className="h-5 mx-1" />

          {/* Delete table */}
          <ToolbarButton onClick={() => editor.chain().focus().deleteTable().run()} title="Delete table">
            <Trash2 className="h-3.5 w-3.5 text-destructive" />
          </ToolbarButton>
        </div>
      )}
    </div>
  );
}
