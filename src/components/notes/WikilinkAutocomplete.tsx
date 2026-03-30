import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Badge } from "@/components/ui/badge";
import { Plus } from "lucide-react";

interface WikilinkAutocompleteProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (title: string, noteId: string) => void;
  onCreate?: (title: string) => void;
  position: { top: number; left: number } | null;
  excludeNoteId?: string;
}

interface NoteResult {
  id: string;
  title: string;
  metadata: Record<string, unknown> | null;
  updated_at: string;
}

export function WikilinkAutocomplete({
  isOpen,
  onClose,
  onSelect,
  onCreate,
  position,
  excludeNoteId,
}: WikilinkAutocompleteProps) {
  const { user } = useAuth();
  const [query, setQuery] = useState("");
  const [notes, setNotes] = useState<NoteResult[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !user) return;
    const fetchNotes = async () => {
      let q = supabase
        .from("notes")
        .select("id, title, metadata, updated_at")
        .eq("user_id", user.id)
        .eq("is_trashed", false)
        .order("updated_at", { ascending: false })
        .limit(15);

      if (query.trim()) {
        q = q.ilike("title", `%${query}%`);
      }

      const { data } = await q;
      const filtered = (data || []).filter((n: any) => n.id !== excludeNoteId);
      setNotes(filtered as NoteResult[]);
      setSelectedIndex(0);
    };
    fetchNotes();
  }, [isOpen, query, user, excludeNoteId]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const hasCreateOption = query.trim() && !notes.some((n) => n.title.toLowerCase() === query.trim().toLowerCase());
      const totalItems = notes.length + (hasCreateOption ? 1 : 0);

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => (i + 1) % totalItems);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => (i - 1 + totalItems) % totalItems);
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (selectedIndex < notes.length) {
          onSelect(notes[selectedIndex].title, notes[selectedIndex].id);
        } else if (hasCreateOption && onCreate) {
          onCreate(query.trim());
        }
        onClose();
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    },
    [notes, selectedIndex, query, onSelect, onCreate, onClose]
  );

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [isOpen, onClose]);

  if (!isOpen || !position) return null;

  const hasCreateOption =
    query.trim() && !notes.some((n) => n.title.toLowerCase() === query.trim().toLowerCase());

  return (
    <div
      ref={containerRef}
      className="fixed z-50 bg-popover border border-border rounded-lg shadow-lg w-72 overflow-hidden"
      style={{ top: position.top + 24, left: position.left }}
    >
      <div className="p-2 border-b border-border">
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search notes…"
          className="w-full text-sm bg-transparent outline-none placeholder:text-muted-foreground/60"
        />
      </div>
      <div className="max-h-52 overflow-y-auto py-1">
        {notes.length === 0 && !hasCreateOption && (
          <div className="py-3 text-xs text-center text-muted-foreground">No notes found</div>
        )}
        {notes.map((note, i) => {
          const noteType = (note.metadata as any)?.type;
          return (
            <button
              key={note.id}
              className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left transition-colors ${
                i === selectedIndex ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"
              }`}
              onMouseEnter={() => setSelectedIndex(i)}
              onClick={() => {
                onSelect(note.title, note.id);
                onClose();
              }}
            >
              <span className="truncate flex-1">{note.title || "Untitled"}</span>
              {noteType && (
                <Badge variant="secondary" className="text-[9px] px-1 py-0 shrink-0">
                  {noteType}
                </Badge>
              )}
            </button>
          );
        })}
        {hasCreateOption && (
          <button
            className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left transition-colors ${
              selectedIndex === notes.length ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"
            }`}
            onMouseEnter={() => setSelectedIndex(notes.length)}
            onClick={() => {
              onCreate?.(query.trim());
              onClose();
            }}
          >
            <Plus className="h-3.5 w-3.5 text-primary" />
            <span className="text-primary">Create: "{query.trim()}"</span>
          </button>
        )}
      </div>
    </div>
  );
}
