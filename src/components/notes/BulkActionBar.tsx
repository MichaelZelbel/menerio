import { useCallback, useState } from "react";
import {
  Check,
  FolderInput,
  Tag as TagIcon,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Note, SemanticSearchResult, useUpdateNote } from "@/hooks/useNotes";
import { showToast } from "@/lib/toast";

interface BulkActionBarProps {
  selectedIds: string[];
  notes: (Note | SemanticSearchResult)[];
  onClear: () => void;
}

export function BulkActionBar({ selectedIds, notes, onClear }: BulkActionBarProps) {
  const updateNote = useUpdateNote();
  const [movePath, setMovePath] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [moveOpen, setMoveOpen] = useState(false);
  const [tagOpen, setTagOpen] = useState(false);

  const count = selectedIds.length;
  const plural = count === 1 ? "" : "s";

  const handleMove = useCallback(async () => {
    const folder = movePath.trim().replace(/^\/+|\/+$/g, "");
    await Promise.all(
      selectedIds.map((id) => updateNote.mutateAsync({ id, folder_path: folder })),
    );
    showToast.success(`Moved ${count} note${plural}`);
    setMovePath("");
    setMoveOpen(false);
    onClear();
  }, [count, movePath, plural, selectedIds, updateNote, onClear]);

  const handleTag = useCallback(async () => {
    const tag = tagInput.trim().replace(/^#/, "");
    if (!tag) return;
    await Promise.all(
      selectedIds.map((id) => {
        const n = notes.find((x) => x.id === id);
        const current = (n?.tags || []) as string[];
        if (current.includes(tag)) return Promise.resolve();
        return updateNote.mutateAsync({ id, tags: [...current, tag] });
      }),
    );
    showToast.success(`Tagged ${count} note${plural}`);
    setTagInput("");
    setTagOpen(false);
    onClear();
  }, [count, notes, plural, selectedIds, tagInput, updateNote, onClear]);

  const handleTrash = useCallback(async () => {
    await Promise.all(
      selectedIds.map((id) =>
        updateNote.mutateAsync({
          id,
          is_trashed: true,
          trashed_at: new Date().toISOString(),
        }),
      ),
    );
    showToast.success(`Moved ${count} to Trash`);
    onClear();
  }, [count, selectedIds, updateNote, onClear]);

  return (
    <div className="shrink-0 border-t border-border bg-background/95 backdrop-blur px-3 py-2 flex items-center gap-2">
      <span className="text-xs text-muted-foreground mr-1">{count} selected</span>

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
              if (e.key === "Enter") handleMove();
            }}
          />
          <Button size="sm" className="w-full h-7 text-xs" onClick={handleMove}>
            <Check className="h-3.5 w-3.5 mr-1" /> Move {count}
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
              if (e.key === "Enter") handleTag();
            }}
          />
          <Button
            size="sm"
            className="w-full h-7 text-xs"
            onClick={handleTag}
            disabled={!tagInput.trim()}
          >
            <Check className="h-3.5 w-3.5 mr-1" /> Tag {count}
          </Button>
        </PopoverContent>
      </Popover>

      <Button
        size="sm"
        variant="ghost"
        className="h-7 gap-1.5 text-xs text-destructive hover:text-destructive"
        onClick={handleTrash}
      >
        <Trash2 className="h-3.5 w-3.5" /> Trash
      </Button>

      <div className="ml-auto">
        <Button
          size="sm"
          variant="ghost"
          className="h-7 w-7 p-0"
          onClick={onClear}
          title="Clear selection"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
