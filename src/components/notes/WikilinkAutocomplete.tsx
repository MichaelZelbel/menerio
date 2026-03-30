import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";

interface WikilinkAutocompleteProps {
  editor: any;
  isOpen: boolean;
  onClose: () => void;
  onSelect: (title: string, noteId: string) => void;
  position: { top: number; left: number } | null;
}

export function WikilinkAutocomplete({ editor, isOpen, onClose, onSelect, position }: WikilinkAutocompleteProps) {
  const { user } = useAuth();
  const [query, setQuery] = useState("");
  const [notes, setNotes] = useState<{ id: string; title: string }[]>([]);

  useEffect(() => {
    if (!isOpen || !user) return;
    const fetchNotes = async () => {
      let q = supabase
        .from("notes")
        .select("id, title")
        .eq("user_id", user.id)
        .eq("is_trashed", false)
        .order("updated_at", { ascending: false })
        .limit(20);

      if (query.trim()) {
        q = q.ilike("title", `%${query}%`);
      }

      const { data } = await q;
      setNotes(data || []);
    };
    fetchNotes();
  }, [isOpen, query, user]);

  if (!isOpen || !position) return null;

  return (
    <div
      className="fixed z-50 bg-popover border rounded-md shadow-md w-64"
      style={{ top: position.top + 24, left: position.left }}
    >
      <Command>
        <CommandInput
          placeholder="Search notes…"
          value={query}
          onValueChange={setQuery}
          className="h-8 text-sm"
        />
        <CommandList>
          <CommandEmpty className="py-2 text-xs text-center text-muted-foreground">
            No notes found
          </CommandEmpty>
          <CommandGroup>
            {notes.map((note) => (
              <CommandItem
                key={note.id}
                value={note.title}
                onSelect={() => {
                  onSelect(note.title, note.id);
                  onClose();
                }}
                className="text-sm"
              >
                {note.title}
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </Command>
    </div>
  );
}
