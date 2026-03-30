import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { SEOHead } from "@/components/SEOHead";
import {
  useNotes,
  useCreateNote,
  useIlikeSearch,
  useSemanticSearch,
  Note,
  SemanticSearchResult,
} from "@/hooks/useNotes";
import { NoteList } from "@/components/notes/NoteList";
import { NoteEditor } from "@/components/notes/NoteEditor";
import { NoteFilter } from "@/components/notes/NoteSidebar";
import { SmartTagsPanel } from "@/components/notes/SmartTagsPanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Plus,
  Search,
  X,
  Brain,
  FileText,
  Star,
  Trash2,
  ChevronDown,
  Filter,
  Check,
  Sparkles,
  Type,
  Tags,
} from "lucide-react";
import { useSearchParams, useParams, useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { showToast } from "@/lib/toast";

const filterConfig: { key: NoteFilter; label: string; icon: typeof FileText }[] = [
  { key: "all", label: "All Notes", icon: FileText },
  { key: "favorites", label: "Favorites", icon: Star },
  { key: "trash", label: "Trash", icon: Trash2 },
];

type SearchMode = "semantic" | "exact";

export default function Notes() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { noteId: urlNoteId } = useParams<{ noteId?: string }>();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<NoteFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(urlNoteId || null);
  const [searchMode, setSearchMode] = useState(false);
  const [showLocalGraph, setShowLocalGraph] = useState(false);

  // Sync selectedId when URL param changes (e.g. from graph node click)
  useEffect(() => {
    if (urlNoteId && urlNoteId !== selectedId) {
      setSelectedId(urlNoteId);
    }
  }, [urlNoteId]);
  const [searchQuery, setSearchQuery] = useState("");
  const [entityFilter, setEntityFilter] = useState<string | null>(null);
  const [searchType, setSearchType] = useState<SearchMode>("semantic");
  const [semanticResults, setSemanticResults] = useState<SemanticSearchResult[] | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [topicFilter, setTopicFilter] = useState<string | null>(null);
  const [personFilter, setPersonFilter] = useState<string | null>(null);
  const [metaTypeFilter, setMetaTypeFilter] = useState<string | null>(null);
  const [showSmartTags, setShowSmartTags] = useState(false);

  const { data: allNotes = [], isLoading: loadingAll } = useNotes("all");
  const { data: favNotes = [] } = useNotes("favorites");
  const { data: trashNotes = [] } = useNotes("trash");
  const createNote = useCreateNote();
  const ilikeSearch = useIlikeSearch();
  const semanticSearch = useSemanticSearch();

  const selectNote = useCallback((id: string | null) => {
    setSelectedId(id);
    if (id) {
      navigate(`/dashboard/notes/${id}`, { replace: true });
    } else {
      navigate("/dashboard/notes", { replace: true });
    }
  }, [navigate]);

  const handleCreate = useCallback(async () => {
    const note = await createNote.mutateAsync({ title: "", content: "" });
    setFilter("all");
    setSearchMode(false);
    selectNote(note.id);
  }, [createNote, selectNote]);

  useEffect(() => {
    if (searchParams.get("action") === "create" && !createNote.isPending) {
      setSearchParams({}, { replace: true });
      handleCreate();
    }
  }, [searchParams, createNote.isPending, handleCreate, setSearchParams]);

  const counts = {
    all: allNotes.length,
    favorites: favNotes.length,
    trash: trashNotes.length,
  };

  const handleSearch = useCallback(
    (q: string) => {
      setSearchQuery(q);
      setSemanticResults(null);
      if (!q.trim()) return;
      ilikeSearch.mutate(q);
      if (searchType === "semantic") {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
          semanticSearch.mutate(
            { query: q },
            { onSuccess: (data) => setSemanticResults(data.results as SemanticSearchResult[]) }
          );
        }, 300);
      }
    },
    [ilikeSearch, semanticSearch, searchType]
  );

  useEffect(() => {
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, []);

  const searchResults: SemanticSearchResult[] | null = useMemo(() => {
    if (!searchMode || !searchQuery.trim()) return null;
    if (searchType === "exact") return ilikeSearch.data || null;
    return semanticResults || ilikeSearch.data || null;
  }, [searchMode, searchQuery, searchType, semanticResults, ilikeSearch.data]);

  const currentNotes = useMemo(() => {
    let notes: (Note | SemanticSearchResult)[];
    if (searchMode && searchResults) notes = searchResults;
    else if (filter === "favorites") notes = favNotes;
    else if (filter === "trash") notes = trashNotes;
    else notes = allNotes;

    if (entityFilter) {
      notes = notes.filter((n) => n.entity_type === entityFilter);
    }
    if (topicFilter) {
      notes = notes.filter((n) => {
        const meta = n.metadata as Record<string, unknown> | null;
        const topics = Array.isArray(meta?.topics) ? (meta.topics as string[]) : [];
        return topics.includes(topicFilter);
      });
    }
    if (personFilter) {
      notes = notes.filter((n) => {
        const meta = n.metadata as Record<string, unknown> | null;
        const people = Array.isArray(meta?.people) ? (meta.people as string[]) : [];
        return people.includes(personFilter);
      });
    }
    if (metaTypeFilter) {
      notes = notes.filter((n) => {
        const meta = n.metadata as Record<string, unknown> | null;
        return meta?.type === metaTypeFilter;
      });
    }
    return notes;
  }, [filter, allNotes, favNotes, trashNotes, searchMode, searchResults, entityFilter, topicFilter, personFilter, metaTypeFilter]);

  const selectedNote = useMemo(() => {
    if (!selectedId) return null;
    return (
      allNotes.find((n) => n.id === selectedId) ||
      trashNotes.find((n) => n.id === selectedId) ||
      favNotes.find((n) => n.id === selectedId) ||
      null
    );
  }, [selectedId, allNotes, trashNotes, favNotes]);

  const activeFilter = filterConfig.find((f) => f.key === filter)!;

  const exitSearch = () => {
    setSearchMode(false);
    setSearchQuery("");
    setSemanticResults(null);
  };

  const clearAllFilters = () => {
    setTopicFilter(null);
    setPersonFilter(null);
    setMetaTypeFilter(null);
  };

  const hasActiveMetaFilter = topicFilter || personFilter || metaTypeFilter;
  const isSemanticLoading = searchType === "semantic" && semanticSearch.isPending;
  const showingSemanticResults = searchType === "semantic" && semanticResults !== null;

  return (
    <div className="flex h-[calc(100vh-56px)] overflow-hidden">
      <SEOHead title="Notes — Menerio" noIndex />

      {/* Smart Tags panel */}
      {showSmartTags && (
        <div className="w-64 shrink-0 border-r border-border bg-background flex flex-col">
          <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
            <span className="text-xs font-semibold flex items-center gap-1.5">
              <Tags className="h-3.5 w-3.5" /> Smart Tags
            </span>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setShowSmartTags(false)}>
              <X className="h-3 w-3" />
            </Button>
          </div>
          <SmartTagsPanel
            notes={allNotes}
            onTopicClick={(topic) => setTopicFilter(topicFilter === topic ? null : topic)}
            onPersonClick={(person) => setPersonFilter(personFilter === person ? null : person)}
            onTypeClick={(type) => setMetaTypeFilter(metaTypeFilter === type ? null : type)}
            onNoteSelect={selectNote}
            activeTopicFilter={topicFilter}
            activeTypeFilter={metaTypeFilter}
          />
        </div>
      )}

      {/* Note list panel */}
      <div className="w-72 shrink-0 border-r border-border flex flex-col bg-background">
        {/* Header */}
        <div className="flex items-center gap-1 px-3 py-2 border-b border-border shrink-0">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="gap-1.5 text-sm font-semibold h-8 px-2">
                <activeFilter.icon className="h-4 w-4" />
                {searchMode ? "Search" : activeFilter.label}
                <span className="text-[10px] text-muted-foreground font-normal">
                  {!searchMode && counts[filter]}
                </span>
                <ChevronDown className="h-3 w-3 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-48">
              {filterConfig.map((f) => (
                <DropdownMenuItem
                  key={f.key}
                  onClick={() => { setFilter(f.key); setSearchMode(false); }}
                  className="gap-2"
                >
                  <f.icon className="h-4 w-4" />
                  <span className="flex-1">{f.label}</span>
                  <span className="text-[10px] text-muted-foreground">{counts[f.key]}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant={entityFilter ? "secondary" : "ghost"}
                size="icon"
                className="h-8 w-8"
                title="Filter by type"
              >
                <Filter className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-40">
              <DropdownMenuItem onClick={() => setEntityFilter(null)} className="gap-2">
                <span className="flex-1">All Types</span>
                {!entityFilter && <Check className="h-3 w-3" />}
              </DropdownMenuItem>
              {["person", "event", "idea", "prompt", "document", "note"].map((t) => (
                <DropdownMenuItem key={t} onClick={() => setEntityFilter(t)} className="gap-2">
                  <span className="flex-1 capitalize">{t}</span>
                  {entityFilter === t && <Check className="h-3 w-3" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <div className="flex-1" />

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={showSmartTags ? "secondary" : "ghost"}
                size="icon"
                className="h-8 w-8"
                onClick={() => setShowSmartTags(!showSmartTags)}
                title="Smart Tags"
              >
                <Tags className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">Smart Tags</TooltipContent>
          </Tooltip>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => setSearchMode(!searchMode)}
            title="Search"
          >
            <Search className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={handleCreate}
            disabled={createNote.isPending}
            title="New note"
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>

        {/* Search bar */}
        {searchMode && (
          <div className="px-3 py-2 border-b border-border shrink-0 space-y-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(e) => handleSearch(e.target.value)}
                placeholder={searchType === "semantic" ? "Smart search…" : "Exact search…"}
                className="pl-8 pr-8 h-8 text-sm"
                autoFocus
              />
              <button
                onClick={exitSearch}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="flex items-center gap-1.5">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={searchType === "semantic" ? "secondary" : "ghost"}
                    size="sm"
                    className={cn(
                      "h-6 px-2 text-[10px] gap-1",
                      searchType === "semantic" && "bg-primary/10 text-primary hover:bg-primary/15"
                    )}
                    onClick={() => {
                      setSearchType("semantic");
                      setSemanticResults(null);
                      if (searchQuery.trim()) handleSearch(searchQuery);
                    }}
                  >
                    <Sparkles className="h-3 w-3" />
                    Smart
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">AI-powered semantic search</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={searchType === "exact" ? "secondary" : "ghost"}
                    size="sm"
                    className="h-6 px-2 text-[10px] gap-1"
                    onClick={() => {
                      setSearchType("exact");
                      setSemanticResults(null);
                      if (searchQuery.trim()) ilikeSearch.mutate(searchQuery);
                    }}
                  >
                    <Type className="h-3 w-3" />
                    Exact
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">Keyword matching</TooltipContent>
              </Tooltip>
              <div className="flex-1" />
              {isSemanticLoading && (
                <span className="text-[10px] text-muted-foreground animate-pulse flex items-center gap-1">
                  <Sparkles className="h-2.5 w-2.5" /> Thinking…
                </span>
              )}
              {showingSemanticResults && !isSemanticLoading && (
                <span className="text-[10px] text-primary flex items-center gap-1">
                  <Sparkles className="h-2.5 w-2.5" /> AI results
                </span>
              )}
            </div>
          </div>
        )}

        {/* Active filter indicators */}
        {hasActiveMetaFilter && (
          <div className="px-3 py-1.5 border-b border-border shrink-0 flex items-center gap-1.5 flex-wrap">
            {topicFilter && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-medium inline-flex items-center gap-1">
                #{topicFilter}
                <button onClick={() => setTopicFilter(null)}><X className="h-2.5 w-2.5" /></button>
              </span>
            )}
            {personFilter && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-500/10 text-violet-700 dark:text-violet-400 font-medium inline-flex items-center gap-1">
                @{personFilter}
                <button onClick={() => setPersonFilter(null)}><X className="h-2.5 w-2.5" /></button>
              </span>
            )}
            {metaTypeFilter && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground font-medium inline-flex items-center gap-1">
                {metaTypeFilter.replace("_", " ")}
                <button onClick={() => setMetaTypeFilter(null)}><X className="h-2.5 w-2.5" /></button>
              </span>
            )}
            <button onClick={clearAllFilters} className="text-[10px] text-muted-foreground hover:text-foreground ml-auto">
              Clear all
            </button>
          </div>
        )}

        {/* Note list */}
        {loadingAll ? (
          <div className="p-4 space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            ))}
          </div>
        ) : (
          <NoteList
            notes={currentNotes}
            selectedId={selectedId}
            onSelect={selectNote}
            showSimilarity={searchMode && showingSemanticResults}
            onTopicClick={(topic) => setTopicFilter(topicFilter === topic ? null : topic)}
          />
        )}
      </div>

      {/* Right panel — editor */}
      <div className="flex-1 min-w-0">
        {selectedNote ? (
          <NoteEditor
            key={selectedNote.id}
            note={selectedNote}
            onNoteDeleted={() => selectNote(null)}
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-center p-8">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
              <Brain className="h-8 w-8 text-primary" />
            </div>
            <h3 className="text-lg font-semibold font-display mb-2">
              Your Open Brain
            </h3>
            <p className="text-sm text-muted-foreground max-w-sm mb-6">
              Select a note to view it, or create a new one to start capturing your thoughts.
            </p>
            <Button onClick={handleCreate} disabled={createNote.isPending} className="gap-2">
              <Plus className="h-4 w-4" /> New Note
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
