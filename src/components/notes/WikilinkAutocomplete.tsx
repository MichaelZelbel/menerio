import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { escapeLike, pgOrValue, ilikeContains } from "@/lib/postgrest";
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
  const listRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const [loading, setLoading] = useState(false);
  const [exactExists, setExactExists] = useState(false);
  const reqId = useRef(0);

  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !user) return;
    const trimmed = query.trim();
    const myReq = ++reqId.current;
    setLoading(true);

    const timer = setTimeout(async () => {
      let q = supabase
        .from("notes")
        .select("id, title, metadata, updated_at")
        .eq("user_id", user.id)
        .eq("is_trashed", false)
        .order("updated_at", { ascending: false })
        .limit(trimmed ? 50 : 15);

      if (trimmed) {
        // Include an exact-title branch so the exactly-titled note can never be
        // truncated away by the recency-ordered contains branch.
        q = q.or(
          [
            `title.ilike.${pgOrValue(escapeLike(trimmed))}`,
            ilikeContains("title", trimmed),
          ].join(",")
        );
      }

      const { data } = await q;
      if (myReq !== reqId.current) return; // stale response

      const rows = (data || []).filter((n: any) => n.id !== excludeNoteId) as NoteResult[];
      const ranked = trimmed ? rankNotes(rows, trimmed) : rows;
      setNotes(ranked.slice(0, 15));
      setExactExists(rows.some((n) => norm(n.title) === norm(trimmed)));
      setSelectedIndex(0);
      setLoading(false);
    }, 150);

    return () => clearTimeout(timer);
  }, [isOpen, query, user, excludeNoteId]);

  const hasCreateOption = useMemo(
    () => !!query.trim() && !loading && !exactExists,
    [query, loading, exactExists]
  );
  const totalItems = notes.length + (hasCreateOption ? 1 : 0);


  // Clamp selectedIndex when results shrink
  useEffect(() => {
    if (totalItems === 0) {
      setSelectedIndex(0);
    } else if (selectedIndex >= totalItems) {
      setSelectedIndex(totalItems - 1);
    }
  }, [totalItems, selectedIndex]);

  // Scroll active item into view on keyboard nav
  useEffect(() => {
    const el = itemRefs.current[selectedIndex];
    if (el) el.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (totalItems === 0) return;
        setSelectedIndex((i) => (i + 1) % totalItems);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        if (totalItems === 0) return;
        setSelectedIndex((i) => (i - 1 + totalItems) % totalItems);
      } else if (e.key === "Home") {
        e.preventDefault();
        setSelectedIndex(0);
      } else if (e.key === "End") {
        e.preventDefault();
        if (totalItems > 0) setSelectedIndex(totalItems - 1);
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (totalItems === 0) return;
        if (selectedIndex < notes.length) {
          onSelect(notes[selectedIndex].title, notes[selectedIndex].id);
        } else if (hasCreateOption && onCreate) {
          onCreate(query.trim());
        }
        onClose();
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "Tab") {
        // Confirm with Tab as well (common in autocomplete UIs)
        if (totalItems === 0) return;
        e.preventDefault();
        if (selectedIndex < notes.length) {
          onSelect(notes[selectedIndex].title, notes[selectedIndex].id);
        } else if (hasCreateOption && onCreate) {
          onCreate(query.trim());
        }
        onClose();
      }
    },
    [notes, selectedIndex, query, onSelect, onCreate, onClose, totalItems, hasCreateOption]
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
      <div ref={listRef} className="max-h-52 overflow-y-auto py-1" role="listbox">
        {notes.length === 0 && !hasCreateOption && (
          <div className="py-3 text-xs text-center text-muted-foreground">No notes found</div>
        )}
        {notes.map((note, i) => {
          const noteType = (note.metadata as any)?.type;
          const active = i === selectedIndex;
          return (
            <button
              key={note.id}
              ref={(el) => { itemRefs.current[i] = el; }}
              role="option"
              aria-selected={active}
              className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left transition-colors ${
                active ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"
              }`}
              onMouseEnter={() => setSelectedIndex(i)}
              onMouseDown={(e) => e.preventDefault()}
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
            ref={(el) => { itemRefs.current[notes.length] = el; }}
            role="option"
            aria-selected={selectedIndex === notes.length}
            className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left transition-colors ${
              selectedIndex === notes.length ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"
            }`}
            onMouseEnter={() => setSelectedIndex(notes.length)}
            onMouseDown={(e) => e.preventDefault()}
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
