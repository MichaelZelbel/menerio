import { memo, useRef, useMemo, useCallback } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Note, SemanticSearchResult } from "@/hooks/useNotes";
import { cn } from "@/lib/utils";
import {
  Star,
  Pin,
  Trash2,
  Link2,
  Image,
  FileText as FileTextIcon,
} from "lucide-react";
import { showToast } from "@/lib/toast";
import { formatDistanceToNow } from "date-fns";
import { getNotePreviewText } from "@/lib/note-content";
import { Checkbox } from "@/components/ui/checkbox";
import { useBulkSelect } from "./useBulkSelect";
import { BulkActionBar } from "./BulkActionBar";
import { CaptureEmptyState } from "./CaptureEmptyState";

interface NoteListProps {
  notes: (Note | SemanticSearchResult)[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  showSimilarity?: boolean;
  onTopicClick?: (topic: string) => void;
  onCreateNote?: () => void;
  emptyVariant?: "default" | "search";
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
    (e: React.MouseEvent) => onClick(e, note.id),
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
            onCheckedChange={() =>
              onClick({ metaKey: true, preventDefault() {}, stopPropagation() {} } as unknown as React.MouseEvent, note.id)
            }
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
  onCreateNote,
  emptyVariant = "default",
}: NoteListProps) {
  const parentRef = useRef<HTMLDivElement>(null);

  const orderedIds = useMemo(() => notes.map((n) => n.id), [notes]);
  const bulk = useBulkSelect(orderedIds);

  const handleRowClick = useCallback(
    (e: React.MouseEvent, id: string) => {
      const consumed = bulk.handleClick(e, id);
      if (consumed) return;
      if (e.button === 0) {
        e.preventDefault();
        onSelect(id);
      }
    },
    [bulk, onSelect]
  );

  const rowVirtualizer = useVirtualizer({
    count: notes.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 92,
    overscan: 8,
    getItemKey: (index) => notes[index]?.id ?? index,
  });

  const selectedIds = useMemo(() => Array.from(bulk.selected), [bulk.selected]);

  if (notes.length === 0) {
    if (emptyVariant === "search") {
      return (
        <div className="flex-1 flex items-center justify-center p-6 text-center">
          <p className="text-sm text-muted-foreground">No notes match your search.</p>
        </div>
      );
    }
    return (
      <div className="flex-1 overflow-y-auto">
        <CaptureEmptyState onCreateNote={onCreateNote} variant="compact" />
      </div>
    );
  }

  const items = rowVirtualizer.getVirtualItems();
  const multiActive = bulk.size > 0;

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
                  isMultiSelected={bulk.isSelected(note.id)}
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
        <BulkActionBar selectedIds={selectedIds} notes={notes} onClear={bulk.clear} />
      )}
    </div>
  );
});
