import { Note } from "@/hooks/useNotes";
import { cn } from "@/lib/utils";
import { Star, Pin, Trash2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface NoteListProps {
  notes: Note[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

function getPreview(content: string, maxLen = 80): string {
  const text = content.replace(/\n/g, " ").trim();
  return text.length > maxLen ? text.slice(0, maxLen) + "…" : text || "No content";
}

export function NoteList({ notes, selectedId, onSelect }: NoteListProps) {
  if (notes.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-6 text-center">
        <p className="text-sm text-muted-foreground">No notes yet. Create one to get started.</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      {notes.map((note) => (
        <button
          key={note.id}
          onClick={() => onSelect(note.id)}
          className={cn(
            "w-full text-left px-4 py-3 border-b border-border transition-colors hover:bg-accent/50",
            selectedId === note.id && "bg-accent"
          )}
        >
          <div className="flex items-center gap-1.5 mb-0.5">
            {note.is_pinned && <Pin className="h-3 w-3 text-primary shrink-0" />}
            {note.is_favorite && <Star className="h-3 w-3 text-warning fill-warning shrink-0" />}
            {note.is_trashed && <Trash2 className="h-3 w-3 text-destructive shrink-0" />}
            <h4 className="text-sm font-medium truncate flex-1">
              {note.title || "Untitled"}
            </h4>
          </div>
          <p className="text-xs text-muted-foreground truncate mb-1">
            {getPreview(note.content)}
          </p>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground/70">
              {formatDistanceToNow(new Date(note.updated_at), { addSuffix: true })}
            </span>
            {note.tags?.length > 0 && (
              <div className="flex gap-1">
                {note.tags.slice(0, 2).map((tag) => (
                  <span
                    key={tag}
                    className="text-[9px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </div>
        </button>
      ))}
    </div>
  );
}
