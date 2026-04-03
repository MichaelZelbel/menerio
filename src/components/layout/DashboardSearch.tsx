import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Search, FileText, Loader2, Sparkles, Image } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useIlikeSearch, useSemanticSearch, type SemanticSearchResult } from "@/hooks/useNotes";
import { cn } from "@/lib/utils";

export function DashboardSearch() {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [ilikeResults, setIlikeResults] = useState<SemanticSearchResult[]>([]);
  const [semanticResults, setSemanticResults] = useState<SemanticSearchResult[]>([]);
  const [mode, setMode] = useState<"idle" | "ilike" | "semantic">("idle");
  const containerRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const ilikeSearch = useIlikeSearch();
  const semanticSearch = useSemanticSearch();

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

  // Debounced search
  useEffect(() => {
    if (!query.trim()) {
      setIlikeResults([]);
      setSemanticResults([]);
      setMode("idle");
      return;
    }

    const timer = setTimeout(async () => {
      setMode("ilike");
      // Fire ILIKE instantly
      try {
        const ilike = await ilikeSearch.mutateAsync(query);
        setIlikeResults(ilike.slice(0, 8));
      } catch { /* ignore */ }

      // Fire semantic in background
      setMode("semantic");
      try {
        const res = await semanticSearch.mutateAsync({ query, limit: 8 });
        setSemanticResults(res.results.slice(0, 8));
      } catch { /* ignore */ }
    }, 250);

    return () => clearTimeout(timer);
  }, [query]);

  const results = semanticResults.length > 0 ? semanticResults : ilikeResults;
  const isSearching = ilikeSearch.isPending || semanticSearch.isPending;

  const selectNote = useCallback((noteId: string) => {
    setOpen(false);
    setQuery("");
    navigate(`/dashboard/notes?note=${noteId}`);
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
        <div className="absolute top-full left-0 right-0 mt-1 z-50 rounded-lg border bg-popover shadow-lg overflow-hidden">
          {results.length === 0 && !isSearching && (
            <p className="text-sm text-muted-foreground text-center py-6">No results found</p>
          )}
          {results.length === 0 && isSearching && (
            <p className="text-sm text-muted-foreground text-center py-6">Searching…</p>
          )}
          {results.length > 0 && (
            <div className="max-h-[320px] overflow-y-auto">
              {semanticResults.length > 0 && (
                <p className="px-3 pt-2 pb-1 text-[10px] font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                  <Sparkles className="h-3 w-3" /> Semantic results
                </p>
              )}
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
            </div>
          )}
        </div>
      )}
    </div>
  );
}
