import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { escapeLike, pgOrValue, ilikeContains } from "@/lib/postgrest";
import { extractSearchTerms, normalizeForMatch, rankNotesByTerms } from "@/lib/search-terms";
import { dbErrorMessage } from "@/lib/function-error";
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
  /** Selected so the shared ranking can put a mirrored mission control file below a native note. */
  source_app?: string | null;
}

/** Normalize a title for comparison: trim, collapse whitespace, strip diacritics, lowercase. */
const norm = normalizeForMatch;

/** Rank title matches with the shared, title-first search ranking. */
function rankNotes(rows: NoteResult[], query: string): NoteResult[] {
  const q = query.trim().toLowerCase();
  const ranked = rankNotesByTerms(rows, q, extractSearchTerms(query));
  // Never drop a row the query already fetched — unranked rows go last.
  const inRanked = new Set(ranked.map((r) => r.id));
  return [...ranked, ...rows.filter((r) => !inRanked.has(r.id))];
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
  // Keyed on the id: a token refresh hands out a new user object, which
  // re-ran the search and briefly un-settled the list.
  const userId = user?.id;
  const [query, setQuery] = useState("");
  const [notes, setNotes] = useState<NoteResult[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const [loading, setLoading] = useState(false);
  const [exactExists, setExactExists] = useState(false);
  // The trimmed query the rows in `notes` answer. The search is debounced, so
  // for 150 ms (plus the round trip) after each keystroke the list still shows
  // the previous query's rows; Enter or Tab in that window used to link
  // whatever note topped the stale list.
  const [resultsFor, setResultsFor] = useState<string | null>(null);
  // A failed search is not "no notes": offering Create there invited a
  // duplicate of a note that exists.
  const [searchError, setSearchError] = useState<string | null>(null);
  const reqId = useRef(0);
  // Enter/Tab pressed before the rows caught up: confirm once they land.
  const pendingConfirm = useRef(false);

  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setSelectedIndex(0);
      setResultsFor(null);
      setSearchError(null);
      pendingConfirm.current = false;
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !userId) return;
    const trimmed = query.trim();
    const myReq = ++reqId.current;
    setLoading(true);

    const timer = setTimeout(async () => {
      let rows: NoteResult[] = [];
      let failure: unknown = null;
      try {
        let q = supabase
          .from("notes")
          .select("id, title, metadata, updated_at, source_app")
          .eq("user_id", userId)
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

        const { data, error } = await q;
        if (error) failure = error;
        else rows = (data || []).filter((n: any) => n.id !== excludeNoteId) as NoteResult[];
      } catch (e) {
        failure = e;
      }
      if (myReq !== reqId.current) return; // stale response

      if (failure) {
        setNotes([]);
        setExactExists(false);
        setSearchError(dbErrorMessage(failure, "Could not search your notes. Type again to retry."));
      } else {
        const ranked = trimmed ? rankNotes(rows, trimmed) : rows;
        setNotes(ranked.slice(0, 15));
        setExactExists(rows.some((n) => norm(n.title) === norm(trimmed)));
        setSearchError(null);
      }
      setResultsFor(trimmed);
      setSelectedIndex(0);
      setLoading(false);
    }, 150);

    return () => clearTimeout(timer);
  }, [isOpen, query, userId, excludeNoteId]);

  // True once the visible rows answer what is typed now.
  const settled = !loading && resultsFor === query.trim();

  const hasCreateOption = useMemo(
    () => !!query.trim() && settled && !searchError && !exactExists,
    [query, settled, searchError, exactExists]
  );
  const totalItems = notes.length + (hasCreateOption ? 1 : 0);

  /** Link the row at `index` (or create the note when it is the Create row). */
  const confirm = useCallback(
    (index: number) => {
      if (totalItems === 0) return;
      if (index < notes.length) {
        onSelect(notes[index].title, notes[index].id);
      } else if (hasCreateOption && onCreate) {
        onCreate(query.trim());
      }
      onClose();
    },
    [notes, query, onSelect, onCreate, onClose, totalItems, hasCreateOption]
  );

  // Enter/Tab pressed while the search was still catching up: confirm the top
  // row of the fresh results, the one the person would have seen.
  useEffect(() => {
    if (!pendingConfirm.current || !settled) return;
    pendingConfirm.current = false;
    if (searchError) return;
    confirm(0);
  }, [settled, searchError, confirm]);


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
      } else if (e.key === "Enter" || e.key === "Tab") {
        // Tab confirms as well (common in autocomplete UIs).
        if (!settled) {
          // The rows on screen belong to an earlier query: wait for the
          // search to catch up instead of linking one of them.
          e.preventDefault();
          pendingConfirm.current = true;
          return;
        }
        // With nothing to pick, Tab keeps moving focus as usual.
        if (totalItems === 0 && e.key === "Tab") return;
        e.preventDefault();
        confirm(selectedIndex);
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    },
    [selectedIndex, onClose, totalItems, settled, confirm]
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
        <input aria-label="Search notes"
          ref={inputRef}
          value={query}
          onChange={(e) => {
            // A pending Enter belonged to what was typed before this change.
            pendingConfirm.current = false;
            setQuery(e.target.value);
          }}
          onKeyDown={handleKeyDown}
          placeholder="Search notes…"
          className="w-full text-sm bg-transparent outline-none placeholder:text-muted-foreground/60"
        />
      </div>
      <div ref={listRef} className="max-h-52 overflow-y-auto py-1" role="listbox">
        {searchError ? (
          <div role="alert" className="px-3 py-3 text-xs text-center text-destructive">
            {searchError}
          </div>
        ) : (
          notes.length === 0 &&
          !hasCreateOption && (
            <div className="py-3 text-xs text-center text-muted-foreground">
              {settled ? "No notes found" : "Searching…"}
            </div>
          )
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
