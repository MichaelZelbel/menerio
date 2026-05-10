import { memo, useRef, useMemo, useCallback, useState, useEffect } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Note, SemanticSearchResult, useUpdateNote } from "@/hooks/useNotes";
import { cn } from "@/lib/utils";
import {
  Star,
  Pin,
  Trash2,
  Link2,
  Image,
  FileText as FileTextIcon,
  Check,
  X,
  FolderInput,
  Tag as TagIcon,
} from "lucide-react";
import { showToast } from "@/lib/toast";
import { formatDistanceToNow } from "date-fns";
import { getNotePreviewText } from "@/lib/note-content";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";

interface NoteListProps {
  notes: (Note | SemanticSearchResult)[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  showSimilarity?: boolean;
  onTopicClick?: (topic: string) => void;
}

function getSimilarityColor(score: number): string {
  if (score >= 0.8) return "bg-emerald-500";
  if (score >= 0.65) return "bg-primary";
  if (score >= 0.5) return "bg-amber-500";
  return "bg-muted-foreground";
}

interface RowProps {
  note: Note | SemanticSearchResult;
  isSelected: boolean;
  isMultiSelected: boolean;
  multiActive: boolean;
  showSimilarity?: boolean;
  onClick: (e: React.MouseEvent, id: string) => void;
}

const NoteRow = memo(function NoteRow({
  note,
  isSelected,
  isMultiSelected,
  multiActive,
  showSimilarity,
  onClick,
}: RowProps) {
  const similarity = "similarity" in note ? (note as SemanticSearchResult).similarity : null;
  const matchSource = "match_source" in note ? (note as SemanticSearchResult).match_source : undefined;
  const mediaDesc = "media_description" in note ? (note as SemanticSearchResult).media_description : undefined;
  const mediaMatchType = "media_type" in note ? (note as SemanticSearchResult).media_type : undefined;
  const isMediaMatch = matchSource === "media" || matchSource === "both";

  const relativeTime = useMemo(
    () => formatDistanceToNow(new Date(note.updated_at), { addSuffix: true }),
    [note.updated_at]
  );
  const previewText = useMemo(() => getNotePreviewText(note.content), [note.content]);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      onClick(e, note.id);
    },
    [note.id, onClick]
  );

  const handleCopy = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      const url = `${window.location.origin}/dashboard/notes/${note.id}`;
      navigator.clipboard.writeText(url);
      showToast.copied();
    },
    [note.id]
  );

  return (
    <a
      href={`/dashboard/notes/${note.id}`}
      onClick={handleClick}
      className={cn(
        "group flex items-start gap-2 w-full text-left px-4 py-3 border-b border-border transition-colors hover:bg-accent/50",
        isSelected && !multiActive && "bg-accent",
        isMultiSelected && "bg-primary/10 hover:bg-primary/15"
      )}
    >
      {multiActive && (
        <div className="pt-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
          <Checkbox
            checked={isMultiSelected}
            onCheckedChange={() => onClick({ metaKey: true } as React.MouseEvent, note.id)}
            aria-label="Select note"
          />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-0.5">
          {note.is_pinned && <Pin className="h-3 w-3 text-primary shrink-0" />}
          {note.is_favorite && <Star className="h-3 w-3 text-warning fill-warning shrink-0" />}
          {note.is_trashed && <Trash2 className="h-3 w-3 text-destructive shrink-0" />}
          <h4 className="text-sm font-medium truncate flex-1">{note.title || "Untitled"}</h4>
          {showSimilarity && similarity !== null && similarity !== undefined && (
            <span className="flex items-center gap-1 shrink-0" title={`${Math.round(similarity * 100)}% match`}>
              <span className={cn("h-1.5 w-1.5 rounded-full", getSimilarityColor(similarity))} />
              <span className="text-[9px] text-muted-foreground font-mono">
                {Math.round(similarity * 100)}%
              </span>
            </span>
          )}
        </div>

        {isMediaMatch && (
          <div className="flex items-center gap-2 mb-1.5">
            <div className="min-w-0 flex-1">
              <span className="text-[10px] font-medium text-primary flex items-center gap-1">
                {mediaMatchType === "pdf" || mediaMatchType === "pdf_page" ? (
                  <><FileTextIcon className="h-2.5 w-2.5" /> Matched in PDF</>
                ) : (
                  <><Image className="h-2.5 w-2.5" /> Matched in image</>
                )}
                {matchSource === "both" && (
                  <span className="text-muted-foreground ml-1">+ note text</span>
                )}
              </span>
              {mediaDesc && (
                <p className="text-[10px] text-muted-foreground truncate">{mediaDesc}</p>
              )}
            </div>
          </div>
        )}

        {!isMediaMatch && (
          <p className="text-xs text-muted-foreground truncate mb-1.5">{previewText}</p>
        )}

        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] text-muted-foreground/70">{relativeTime}</span>
          <button
            onClick={handleCopy}
            className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
            title="Copy link"
          >
            <Link2 className="h-2.5 w-2.5" />
          </button>
        </div>
      </div>
    </a>
  );
});

export const NoteList = memo(function NoteList({
  notes,
  selectedId,
  onSelect,
  showSimilarity,
}: NoteListProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const updateNote = useUpdateNote();

  const [multiSelected, setMultiSelected] = useState<Set<string>>(new Set());
  const lastClickedRef = useRef<string | null>(null);
  const [movePath, setMovePath] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [moveOpen, setMoveOpen] = useState(false);
  const [tagOpen, setTagOpen] = useState(false);

  // Drop selections that no longer exist (e.g. after delete).
  useEffect(() => {
    if (multiSelected.size === 0) return;
    const ids = new Set(notes.map((n) => n.id));
    let changed = false;
    const next = new Set<string>();
    multiSelected.forEach((id) => {
      if (ids.has(id)) next.add(id);
      else changed = true;
    });
    if (changed) setMultiSelected(next);
  }, [notes, multiSelected]);

  const noteIndex = useMemo(() => {
    const map = new Map<string, number>();
    notes.forEach((n, i) => map.set(n.id, i));
    return map;
  }, [notes]);

  const handleRowClick = useCallback(
    (e: React.MouseEvent, id: string) => {
      const isMod = e.metaKey || e.ctrlKey;
      const isShift = e.shiftKey;

      if (isMod) {
        e.preventDefault();
        setMultiSelected((prev) => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        });
        lastClickedRef.current = id;
        return;
      }

      if (isShift && lastClickedRef.current && lastClickedRef.current !== id) {
        e.preventDefault();
        const a = noteIndex.get(lastClickedRef.current);
        const b = noteIndex.get(id);
        if (a !== undefined && b !== undefined) {
          const [start, end] = a < b ? [a, b] : [b, a];
          setMultiSelected((prev) => {
            const next = new Set(prev);
            for (let i = start; i <= end; i++) next.add(notes[i].id);
            return next;
          });
        }
        return;
      }

      // Plain click — clear multi-selection and navigate.
      if (multiSelected.size > 0) {
        setMultiSelected(new Set());
      }
      if (e.button === 0) {
        e.preventDefault();
        onSelect(id);
      }
      lastClickedRef.current = id;
    },
    [multiSelected.size, noteIndex, notes, onSelect]
  );

  const clearSelection = useCallback(() => setMultiSelected(new Set()), []);

  const selectedIds = useMemo(() => Array.from(multiSelected), [multiSelected]);

  const handleBulkMove = useCallback(async () => {
    const folder = movePath.trim().replace(/^\/+|\/+$/g, "");
    await Promise.all(
      selectedIds.map((id) => updateNote.mutateAsync({ id, folder_path: folder }))
    );
    showToast.success(`Moved ${selectedIds.length} note${selectedIds.length === 1 ? "" : "s"}`);
    setMovePath("");
    setMoveOpen(false);
    clearSelection();
  }, [movePath, selectedIds, updateNote, clearSelection]);

  const handleBulkTag = useCallback(async () => {
    const tag = tagInput.trim().replace(/^#/, "");
    if (!tag) return;
    await Promise.all(
      selectedIds.map((id) => {
        const n = notes.find((x) => x.id === id);
        const current = (n?.tags || []) as string[];
        if (current.includes(tag)) return Promise.resolve();
        return updateNote.mutateAsync({ id, tags: [...current, tag] });
      })
    );
    showToast.success(`Tagged ${selectedIds.length} note${selectedIds.length === 1 ? "" : "s"}`);
    setTagInput("");
    setTagOpen(false);
    clearSelection();
  }, [tagInput, selectedIds, notes, updateNote, clearSelection]);

  const handleBulkTrash = useCallback(async () => {
    await Promise.all(
      selectedIds.map((id) =>
        updateNote.mutateAsync({ id, is_trashed: true, trashed_at: new Date().toISOString() })
      )
    );
    showToast.success(`Moved ${selectedIds.length} to Trash`);
    clearSelection();
  }, [selectedIds, updateNote, clearSelection]);

  const rowVirtualizer = useVirtualizer({
    count: notes.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 92,
    overscan: 8,
    getItemKey: (index) => notes[index]?.id ?? index,
  });

  if (notes.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-6 text-center">
        <p className="text-sm text-muted-foreground">No notes yet. Create one to get started.</p>
      </div>
    );
  }

  const items = rowVirtualizer.getVirtualItems();
  const multiActive = multiSelected.size > 0;

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div ref={parentRef} className="flex-1 overflow-y-auto">
        <div
          style={{
            height: `${rowVirtualizer.getTotalSize()}px`,
            width: "100%",
            position: "relative",
          }}
        >
          {items.map((virtualRow) => {
            const note = notes[virtualRow.index];
            return (
              <div
                key={virtualRow.key}
                data-index={virtualRow.index}
                ref={rowVirtualizer.measureElement}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                <NoteRow
                  note={note}
                  isSelected={selectedId === note.id}
                  isMultiSelected={multiSelected.has(note.id)}
                  multiActive={multiActive}
                  showSimilarity={showSimilarity}
                  onClick={handleRowClick}
                />
              </div>
            );
          })}
        </div>
      </div>

      {multiActive && (
        <div className="shrink-0 border-t border-border bg-background/95 backdrop-blur px-3 py-2 flex items-center gap-2">
          <span className="text-xs text-muted-foreground mr-1">
            {multiSelected.size} selected
          </span>

          <Popover open={moveOpen} onOpenChange={setMoveOpen}>
            <PopoverTrigger asChild>
              <Button size="sm" variant="ghost" className="h-7 gap-1.5 text-xs">
                <FolderInput className="h-3.5 w-3.5" /> Move
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-64 p-3 space-y-2">
              <p className="text-xs font-medium text-muted-foreground">
                Move to folder (empty = Vault root)
              </p>
              <Input
                value={movePath}
                onChange={(e) => setMovePath(e.target.value)}
                placeholder="e.g. work/inbox"
                className="h-8 text-xs"
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleBulkMove();
                }}
              />
              <Button size="sm" className="w-full h-7 text-xs" onClick={handleBulkMove}>
                <Check className="h-3.5 w-3.5 mr-1" /> Move {selectedIds.length}
              </Button>
            </PopoverContent>
          </Popover>

          <Popover open={tagOpen} onOpenChange={setTagOpen}>
            <PopoverTrigger asChild>
              <Button size="sm" variant="ghost" className="h-7 gap-1.5 text-xs">
                <TagIcon className="h-3.5 w-3.5" /> Tag
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-64 p-3 space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Add tag to selected</p>
              <Input
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                placeholder="tag-name"
                className="h-8 text-xs"
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleBulkTag();
                }}
              />
              <Button
                size="sm"
                className="w-full h-7 text-xs"
                onClick={handleBulkTag}
                disabled={!tagInput.trim()}
              >
                <Check className="h-3.5 w-3.5 mr-1" /> Tag {selectedIds.length}
              </Button>
            </PopoverContent>
          </Popover>

          <Button
            size="sm"
            variant="ghost"
            className="h-7 gap-1.5 text-xs text-destructive hover:text-destructive"
            onClick={handleBulkTrash}
          >
            <Trash2 className="h-3.5 w-3.5" /> Trash
          </Button>

          <div className="ml-auto">
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0"
              onClick={clearSelection}
              title="Clear selection"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
});
