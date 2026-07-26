import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Search, FileText, Loader2, Sparkles, Image } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useIlikeSearch, useSemanticSearch, type SemanticSearchResult } from "@/hooks/useNotes";

/**
 * Merge incoming results into the existing list WITHOUT reordering.
 * - Rows already present keep their exact position; only their data is enriched.
 * - Genuinely new rows are appended at the end.
 */
function mergeStable(
  current: SemanticSearchResult[],
  incoming: SemanticSearchResult[],
  max: number
): SemanticSearchResult[] {
  const byId = new Map(current.map((r) => [r.id, r]));
  const merged = current.map((r) => {
    const next = incoming.find((i) => i.id === r.id);
    if (!next) return r;
    return {
      ...r,
      ...next,
      // Never let an enrichment blank out what is already rendered
      title: next.title || r.title,
      similarity: next.similarity ?? r.similarity,
      match_source: next.match_source ?? r.match_source,
    };
  });
  for (const item of incoming) {
    if (!byId.has(item.id) && merged.length < max) merged.push(item);
  }
  return merged.slice(0, max);
}

const MAX_RESULTS = 8;

export function DashboardSearch() {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<SemanticSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  // Freeze updates while the pointer is inside the dropdown so the row under
  // the cursor can never change identity mid-click.
  const isHoveringRef = useRef(false);
  const resultsRef = useRef<SemanticSearchResult[]>([]);
  const pendingRef = useRef<SemanticSearchResult[] | null>(null);
  const requestIdRef = useRef(0);

  const ilikeSearch = useIlikeSearch();
  const semanticSearch = useSemanticSearch();

  const setVisible = useCallback((next: SemanticSearchResult[]) => {
    resultsRef.current = next;
    pendingRef.current = null;
    setResults(next);
  }, []);

  const commit = useCallback((updater: (prev: SemanticSearchResult[]) => SemanticSearchResult[]) => {
    const base = pendingRef.current ?? resultsRef.current;
    const next = updater(base);
    if (isHoveringRef.current) {
      pendingRef.current = next; // keep the visible list frozen
      return;
    }
    setVisible(next);
  }, [setVisible]);

  const flushPending = useCallback(() => {
    isHoveringRef.current = false;
    if (pendingRef.current) setVisible(pendingRef.current);
  }, [setVisible]);


  // Close on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Debounced search — both passes feed one stable, append-only list
  useEffect(() => {
    if (!query.trim()) {
      requestIdRef.current += 1;
      setVisible([]);
      setIsSearching(false);
      return;
    }

    const timer = setTimeout(async () => {
      const reqId = ++requestIdRef.current;
      setVisible([]);
      setIsSearching(true);


      try {
        const ilike = await ilikeSearch.mutateAsync(query);
        if (requestIdRef.current !== reqId) return;
        commit((prev) => mergeStable(prev, ilike, MAX_RESULTS));
      } catch { /* ignore */ }

      try {
        const res = await semanticSearch.mutateAsync({ query, limit: MAX_RESULTS, threshold: 0.25 });
        if (requestIdRef.current !== reqId) return;
        commit((prev) => mergeStable(prev, res.results, MAX_RESULTS));
      } catch { /* ignore */ }

      if (requestIdRef.current === reqId) setIsSearching(false);
    }, 250);

    return () => clearTimeout(timer);
  }, [query, commit, setVisible]);

  const selectNote = useCallback((noteId: string) => {
    setOpen(false);
    setQuery("");
    navigate(`/dashboard/notes/${noteId}`);
  }, [navigate]);

  // Keyboard shortcut: Cmd/Ctrl+K
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen(true);
        setTimeout(() => {
          containerRef.current?.querySelector("input")?.focus();
        }, 50);
      }
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  const matchIcon = (source?: string) => {
    if (source === "media") return <Image className="h-3.5 w-3.5 text-muted-foreground" />;
    if (source === "both") return <Sparkles className="h-3.5 w-3.5 text-primary" />;
    return <FileText className="h-3.5 w-3.5 text-muted-foreground" />;
  };

  return (
    <div ref={containerRef} className="relative w-full max-w-md">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => { if (query.trim()) setOpen(true); }}
          placeholder="Search notes… ⌘K"
          className="pl-9 pr-8 h-9 text-sm bg-muted/50 border-transparent focus-visible:border-input"
        />
        {isSearching && (
          <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
        )}
      </div>

      {open && query.trim() && (
        <div
          className="absolute top-full left-0 right-0 mt-1 z-50 rounded-lg border bg-popover shadow-lg overflow-hidden"
          onMouseEnter={() => { isHoveringRef.current = true; }}
          onMouseLeave={flushPending}
        >
          {results.length === 0 && !isSearching && (
            <p className="text-sm text-muted-foreground text-center py-6">No results found</p>
          )}
          {results.length === 0 && isSearching && (
            <p className="text-sm text-muted-foreground text-center py-6">Searching…</p>
          )}
          {results.length > 0 && (
            <div className="max-h-[320px] overflow-y-auto">
              {results.map((r) => (
                <button
                  key={r.id}
                  onClick={() => selectNote(r.id)}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left hover:bg-accent transition-colors"
                >
                  {matchIcon(r.match_source)}
                  <span className="truncate flex-1 font-medium">{r.title || "Untitled"}</span>
                  {r.similarity != null && (
                    <span className="text-[10px] text-muted-foreground shrink-0">
                      {Math.round(r.similarity * 100)}%
                    </span>
                  )}
                </button>
              ))}
              {isSearching && (
                <p className="px-3 py-1.5 text-[10px] text-muted-foreground border-t">
                  Refining results…
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
