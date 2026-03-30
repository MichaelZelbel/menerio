import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useNotes } from "@/hooks/useNotes";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { FileText, Search, Link2, Loader2 } from "lucide-react";
import { showToast } from "@/lib/toast";
import { useQueryClient } from "@tanstack/react-query";

interface LinkToNoteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targetNoteId: string;
  targetNoteTitle: string;
}

export function LinkToNoteDialog({
  open,
  onOpenChange,
  targetNoteId,
  targetNoteTitle,
}: LinkToNoteDialogProps) {
  const { user } = useAuth();
  const { data: notes = [] } = useNotes();
  const [search, setSearch] = useState("");
  const [linking, setLinking] = useState(false);
  const queryClient = useQueryClient();

  const filtered = notes
    .filter((n) => n.id !== targetNoteId && !n.is_trashed)
    .filter((n) =>
      search
        ? n.title.toLowerCase().includes(search.toLowerCase())
        : true
    )
    .slice(0, 20);

  const handleLink = async (sourceNoteId: string) => {
    if (!user) return;
    setLinking(true);
    try {
      // Append a wikilink to the source note's content
      const { data: sourceNote } = await supabase
        .from("notes")
        .select("content")
        .eq("id", sourceNoteId)
        .single();

      if (!sourceNote) throw new Error("Note not found");

      const wikilinkHtml = `<p><span data-type="wikilink" data-note-id="${targetNoteId}" data-note-title="${targetNoteTitle}" data-display-text="">${targetNoteTitle}</span></p>`;
      const updatedContent = sourceNote.content + "\n" + wikilinkHtml;

      await supabase
        .from("notes")
        .update({ content: updatedContent })
        .eq("id", sourceNoteId);

      // Create the connection
      await supabase.from("note_connections" as any).upsert(
        {
          user_id: user.id,
          source_note_id: sourceNoteId,
          target_note_id: targetNoteId,
          connection_type: "manual_link",
          strength: 1.0,
          metadata: {},
        },
        { onConflict: "user_id,source_note_id,target_note_id,connection_type" }
      );

      queryClient.invalidateQueries({ queryKey: ["backlinks"] });
      queryClient.invalidateQueries({ queryKey: ["note-connections"] });
      showToast.success("Link created");
      onOpenChange(false);
    } catch (err) {
      console.error("Failed to link:", err);
      showToast.error("Failed to create link");
    } finally {
      setLinking(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="h-4 w-4" />
            Link to "{targetNoteTitle}"
          </DialogTitle>
          <DialogDescription>
            Choose a note to add a wikilink pointing to this note.
          </DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search notes…"
            className="pl-9 h-9 text-sm"
            autoFocus
          />
        </div>
        <ScrollArea className="max-h-[300px]">
          <div className="space-y-0.5">
            {filtered.map((note) => (
              <button
                key={note.id}
                onClick={() => handleLink(note.id)}
                disabled={linking}
                className="w-full flex items-center gap-2 rounded-md px-3 py-2 text-left hover:bg-accent transition-colors disabled:opacity-50"
              >
                <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span className="text-sm truncate flex-1">
                  {note.title || "Untitled"}
                </span>
                {linking && <Loader2 className="h-3 w-3 animate-spin" />}
              </button>
            ))}
            {filtered.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-4">
                No matching notes found
              </p>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
