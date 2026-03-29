import { Note, SemanticSearchResult } from "@/hooks/useNotes";
import { cn } from "@/lib/utils";
import { Star, Pin, Trash2, ExternalLink, CheckSquare, User, Hash, MessageSquare, Zap, Link2 } from "lucide-react";
import { showToast } from "@/lib/toast";
import { formatDistanceToNow } from "date-fns";
import { getNotePreviewText } from "@/lib/note-content";

interface NoteListProps {
  notes: (Note | SemanticSearchResult)[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  showSimilarity?: boolean;
  onTopicClick?: (topic: string) => void;
}

const ENTITY_COLORS: Record<string, string> = {
  person: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  event: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  idea: "bg-violet-500/15 text-violet-700 dark:text-violet-400",
  prompt: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  document: "bg-slate-500/15 text-slate-700 dark:text-slate-400",
  note: "bg-gray-500/15 text-gray-700 dark:text-gray-400",
};

const TYPE_COLORS: Record<string, string> = {
  observation: "bg-slate-500/15 text-slate-600 dark:text-slate-400",
  task: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  idea: "bg-violet-500/15 text-violet-700 dark:text-violet-400",
  reference: "bg-cyan-500/15 text-cyan-700 dark:text-cyan-400",
  person_note: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  meeting_note: "bg-rose-500/15 text-rose-700 dark:text-rose-400",
  decision: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  project: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-400",
};

function getSimilarityColor(score: number): string {
  if (score >= 0.8) return "bg-emerald-500";
  if (score >= 0.65) return "bg-primary";
  if (score >= 0.5) return "bg-amber-500";
  return "bg-muted-foreground";
}

export function NoteList({ notes, selectedId, onSelect, showSimilarity, onTopicClick }: NoteListProps) {
  if (notes.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-6 text-center">
        <p className="text-sm text-muted-foreground">No notes yet. Create one to get started.</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      {notes.map((note) => {
        const similarity = "similarity" in note ? (note as SemanticSearchResult).similarity : null;
        const meta = note.metadata as Record<string, unknown> | null;
        const topics = Array.isArray(meta?.topics) ? (meta.topics as string[]) : [];
        const people = Array.isArray(meta?.people) ? (meta.people as string[]) : [];
        const actionItems = Array.isArray(meta?.action_items) ? (meta.action_items as string[]) : [];
        const metaType = typeof meta?.type === "string" ? meta.type : null;
        const hasMetadata = topics.length > 0 || people.length > 0 || actionItems.length > 0 || metaType;

        return (
          <button
            key={note.id}
            onClick={() => onSelect(note.id)}
            className={cn(
              "group w-full text-left px-4 py-3 border-b border-border transition-colors hover:bg-accent/50",
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
              {showSimilarity && similarity !== null && similarity !== undefined && (
                <span className="flex items-center gap-1 shrink-0" title={`${Math.round(similarity * 100)}% match`}>
                  <span className={cn("h-1.5 w-1.5 rounded-full", getSimilarityColor(similarity))} />
                  <span className="text-[9px] text-muted-foreground font-mono">
                    {Math.round(similarity * 100)}%
                  </span>
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground truncate mb-1.5">
              {getNotePreviewText(note.content)}
            </p>

            {/* Metadata pills */}
            {hasMetadata && (
              <div className="flex items-center gap-1 flex-wrap mb-1.5">
                {metaType && (
                  <span className={cn(
                    "text-[9px] px-1.5 py-0.5 rounded-full font-medium",
                    TYPE_COLORS[metaType] || "bg-muted text-muted-foreground"
                  )}>
                    {metaType.replace("_", " ")}
                  </span>
                )}
                {topics.slice(0, 3).map((topic) => (
                  <span
                    key={topic}
                    onClick={(e) => {
                      e.stopPropagation();
                      onTopicClick?.(topic);
                    }}
                    className="text-[9px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-medium cursor-pointer hover:bg-primary/20 inline-flex items-center gap-0.5"
                  >
                    <Hash className="h-2 w-2" />
                    {topic}
                  </span>
                ))}
                {people.slice(0, 2).map((person) => (
                  <span
                    key={person}
                    className="text-[9px] px-1.5 py-0.5 rounded-full bg-violet-500/10 text-violet-700 dark:text-violet-400 font-medium inline-flex items-center gap-0.5"
                  >
                    <User className="h-2 w-2" />
                    {person}
                  </span>
                ))}
                {actionItems.length > 0 && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-700 dark:text-amber-400 font-medium inline-flex items-center gap-0.5">
                    <CheckSquare className="h-2 w-2" />
                    {actionItems.length} to-do{actionItems.length > 1 ? "s" : ""}
                  </span>
                )}
              </div>
            )}

            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[10px] text-muted-foreground/70">
                {formatDistanceToNow(new Date(note.updated_at), { addSuffix: true })}
              </span>
              {note.entity_type && (
                <span className={cn(
                  "text-[9px] px-1.5 py-0.5 rounded-full font-medium",
                  ENTITY_COLORS[note.entity_type] || "bg-muted text-muted-foreground"
                )}>
                  {note.entity_type}
                </span>
              )}
              {/* Slack source badge */}
              {(() => {
                const m = note.metadata as Record<string, unknown> | null;
                const source = m?.source as string | undefined;
                if (source === "slack") {
                  return (
                    <span className="inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded-full bg-[#4A154B]/15 text-[#4A154B] dark:text-purple-400 font-medium">
                      <MessageSquare className="h-2.5 w-2.5" />
                      Slack
                    </span>
                  );
                }
                if (m?.is_quick_capture) {
                  return (
                    <span className="inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
                      <Zap className="h-2.5 w-2.5" />
                      Quick
                    </span>
                  );
                }
                return null;
              })()}
              {note.is_external && note.source_app && (
                <span className="inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded-full bg-orange-500/15 text-orange-700 dark:text-orange-400 font-medium">
                  <ExternalLink className="h-2.5 w-2.5" />
                  {note.source_app}
                </span>
              )}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  const url = `${window.location.origin}/dashboard/notes/${note.id}`;
                  navigator.clipboard.writeText(url);
                  showToast.copied();
                }}
                className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
                title="Copy link"
              >
                <Link2 className="h-2.5 w-2.5" />
              </button>
              {note.tags?.length > 0 && (
                <>
                  {note.tags.slice(0, 2).map((tag) => (
                    <span
                      key={tag}
                      className="text-[9px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary"
                    >
                      {tag}
                    </span>
                  ))}
                </>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}
