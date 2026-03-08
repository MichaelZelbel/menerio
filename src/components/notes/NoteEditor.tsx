import { useState, useEffect, useCallback, useRef } from "react";
import { Note, useUpdateNote, useDeleteNote, useProcessNote } from "@/hooks/useNotes";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Star,
  Pin,
  Trash2,
  MoreHorizontal,
  Copy,
  RotateCcw,
  Sparkles,
  Tag,
  X,
  Info,
  Loader2,
  Brain,
} from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import { showToast } from "@/lib/toast";

interface NoteEditorProps {
  note: Note;
  onNoteDeleted?: () => void;
}

export function NoteEditor({ note, onNoteDeleted }: NoteEditorProps) {
  const updateNote = useUpdateNote();
  const deleteNote = useDeleteNote();
  const processNote = useProcessNote();
  const [title, setTitle] = useState(note.title);
  const [content, setContent] = useState(note.content);
  const [tagInput, setTagInput] = useState("");
  const [showTagInput, setShowTagInput] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync state when note changes
  useEffect(() => {
    setTitle(note.title);
    setContent(note.content);
    setShowTagInput(false);
    setShowInfo(false);
  }, [note.id]);

  const save = useCallback(
    (updates: { title?: string; content?: string }) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        updateNote.mutate({ id: note.id, ...updates });
      }, 800);
    },
    [note.id, updateNote]
  );

  const handleTitleChange = (val: string) => {
    setTitle(val);
    save({ title: val });
  };

  const handleContentChange = (val: string) => {
    setContent(val);
    save({ content: val });
  };

  const toggleFavorite = () => {
    updateNote.mutate({ id: note.id, is_favorite: !note.is_favorite });
  };

  const togglePin = () => {
    updateNote.mutate({ id: note.id, is_pinned: !note.is_pinned });
  };

  const moveToTrash = () => {
    updateNote.mutate({
      id: note.id,
      is_trashed: true,
      trashed_at: new Date().toISOString(),
    });
    showToast.success("Note moved to trash");
  };

  const restoreFromTrash = () => {
    updateNote.mutate({
      id: note.id,
      is_trashed: false,
      trashed_at: null,
    });
    showToast.success("Note restored");
  };

  const permanentDelete = () => {
    deleteNote.mutate(note.id);
    setShowDeleteDialog(false);
    onNoteDeleted?.();
  };

  const duplicateNote = () => {
    // This is handled at the parent level — we just show a toast
    showToast.info("Use the create button to duplicate");
  };

  const addTag = () => {
    const tag = tagInput.trim().toLowerCase();
    if (!tag || note.tags?.includes(tag)) {
      setTagInput("");
      return;
    }
    const newTags = [...(note.tags || []), tag];
    updateNote.mutate({ id: note.id, tags: newTags });
    setTagInput("");
  };

  const removeTag = (tag: string) => {
    const newTags = (note.tags || []).filter((t) => t !== tag);
    updateNote.mutate({ id: note.id, tags: newTags });
  };

  const handleProcessAI = () => {
    processNote.mutate(note.id, {
      onSuccess: () => {
        showToast.success("AI processing complete — metadata updated");
      },
      onError: () => {
        showToast.error("AI processing failed. Check your OpenRouter API key.");
      },
    });
  };

  const wordCount = content.trim() ? content.trim().split(/\s+/).length : 0;
  const charCount = content.length;
  const metadata = note.metadata as Record<string, unknown> | null;

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-1 px-4 py-2 border-b border-border bg-background shrink-0">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={toggleFavorite}
          title={note.is_favorite ? "Remove from favorites" : "Add to favorites"}
        >
          <Star
            className={cn("h-4 w-4", note.is_favorite && "fill-warning text-warning")}
          />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={togglePin}
          title={note.is_pinned ? "Unpin" : "Pin to top"}
        >
          <Pin className={cn("h-4 w-4", note.is_pinned && "text-primary")} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => setShowTagInput(!showTagInput)}
          title="Add tag"
        >
          <Tag className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={handleProcessAI}
          disabled={processNote.isPending}
          title="Process with AI (generate embeddings & metadata)"
        >
          {processNote.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Brain className="h-4 w-4" />
          )}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => setShowInfo(!showInfo)}
          title="Note info"
        >
          <Info className="h-4 w-4" />
        </Button>

        <div className="flex-1" />

        {note.is_trashed ? (
          <>
            <Button variant="ghost" size="sm" onClick={restoreFromTrash} className="gap-1.5 text-xs">
              <RotateCcw className="h-3.5 w-3.5" /> Restore
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowDeleteDialog(true)}
              className="gap-1.5 text-xs text-destructive hover:text-destructive"
            >
              <Trash2 className="h-3.5 w-3.5" /> Delete Forever
            </Button>
          </>
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={moveToTrash}>
                <Trash2 className="mr-2 h-4 w-4" /> Move to Trash
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  navigator.clipboard.writeText(`${title}\n\n${content}`);
                  showToast.success("Copied to clipboard");
                }}
              >
                <Copy className="mr-2 h-4 w-4" /> Copy to Clipboard
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {/* Info panel */}
      {showInfo && (
        <div className="px-4 py-3 border-b border-border bg-muted/30 text-xs text-muted-foreground space-y-1 shrink-0">
          <p>Created: {format(new Date(note.created_at), "PPp")}</p>
          <p>Updated: {format(new Date(note.updated_at), "PPp")}</p>
          <p>{wordCount} words · {charCount} characters</p>
          {metadata?.type && <p>Type: {String(metadata.type)}</p>}
          {metadata?.summary && <p>Summary: {String(metadata.summary)}</p>}
          {Array.isArray(metadata?.topics) && (metadata.topics as string[]).length > 0 && (
            <p>Topics: {(metadata.topics as string[]).join(", ")}</p>
          )}
          {Array.isArray(metadata?.people) && (metadata.people as string[]).length > 0 && (
            <p>People: {(metadata.people as string[]).join(", ")}</p>
          )}
          {Array.isArray(metadata?.action_items) && (metadata.action_items as string[]).length > 0 && (
            <p>Action items: {(metadata.action_items as string[]).join("; ")}</p>
          )}
        </div>
      )}

      {/* Tags */}
      {(showTagInput || (note.tags && note.tags.length > 0)) && (
        <div className="flex items-center gap-1.5 px-4 py-2 border-b border-border flex-wrap shrink-0">
          {note.tags?.map((tag) => (
            <Badge key={tag} variant="secondary" className="text-xs gap-1 pr-1">
              {tag}
              <button onClick={() => removeTag(tag)} className="hover:text-destructive">
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
          {showTagInput && (
            <Input
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); addTag(); }
                if (e.key === "Escape") setShowTagInput(false);
              }}
              placeholder="Add tag…"
              className="h-6 w-24 text-xs border-none shadow-none focus-visible:ring-0 px-1"
              autoFocus
            />
          )}
        </div>
      )}

      {/* Editor */}
      <div className="flex-1 overflow-y-auto p-4">
        <input
          value={title}
          onChange={(e) => handleTitleChange(e.target.value)}
          placeholder="Untitled"
          className="w-full text-2xl font-bold font-display bg-transparent border-none outline-none placeholder:text-muted-foreground/40 mb-4"
          disabled={note.is_trashed}
        />
        <textarea
          value={content}
          onChange={(e) => handleContentChange(e.target.value)}
          placeholder="Start writing…"
          className="w-full min-h-[calc(100vh-300px)] bg-transparent border-none outline-none resize-none text-sm leading-relaxed placeholder:text-muted-foreground/40"
          disabled={note.is_trashed}
        />
      </div>

      {/* Status bar */}
      <div className="flex items-center justify-between px-4 py-1.5 border-t border-border bg-muted/30 text-[10px] text-muted-foreground shrink-0">
        <span>
          {updateNote.isPending ? "Saving…" : `Saved ${formatDistanceToNow(new Date(note.updated_at), { addSuffix: true })}`}
        </span>
        <span>{wordCount} words</span>
      </div>

      {/* Delete confirmation */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Permanently Delete Note</AlertDialogTitle>
            <AlertDialogDescription>
              This cannot be undone. The note will be permanently removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={permanentDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete Forever
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function cn(...classes: (string | boolean | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}
