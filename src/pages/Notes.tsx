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
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Plus,
  Search,
  X,
  
  FileText,
  Star,
  Trash2,
  ChevronDown,
  ChevronRight,
  Filter,
  Check,
  Sparkles,
  Type,
  Image,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Hash,
  User,
  Folder,
  LayoutGrid,
  Loader2,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { showToast } from "@/lib/toast";
import { useSearchParams, useParams, useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";

const filterConfig: { key: NoteFilter; label: string; icon: typeof FileText }[] = [
  { key: "all", label: "All Notes", icon: FileText },
  { key: "favorites", label: "Favorites", icon: Star },
  { key: "trash", label: "Trash", icon: Trash2 },
];

type SearchMode = "semantic" | "exact";
type SearchScope = "all" | "notes" | "media";
type SortField = "updated_at" | "created_at" | "title";
type SortDirection = "asc" | "desc";

const sortLabels: Record<SortField, string> = {
  updated_at: "Last Edited",
  created_at: "Date Created",
  title: "Title",
};

const defaultDirections: Record<SortField, SortDirection> = {
  updated_at: "desc",
  created_at: "desc",
  title: "asc",
};

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
  const [searchScope, setSearchScope] = useState<SearchScope>("all");
  const [semanticResults, setSemanticResults] = useState<SemanticSearchResult[] | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [topicFilter, setTopicFilter] = useState<string | null>(null);
  const [personFilter, setPersonFilter] = useState<string | null>(null);
  const [metaTypeFilter, setMetaTypeFilter] = useState<string | null>(null);
  const [folderFilter, setFolderFilter] = useState<string | null>(null);
  const [newFolderPath, setNewFolderPath] = useState("");
  
  const [sortField, setSortField] = useState<SortField>("updated_at");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

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
    const note = await createNote.mutateAsync({ title: "", content: "", folder_path: folderFilter || "" });
    setFilter("all");
    setSearchMode(false);
    selectNote(note.id);
  }, [createNote, folderFilter, selectNote]);

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
            { query: q, scope: searchScope },
            { onSuccess: (data) => setSemanticResults(data.results as SemanticSearchResult[]) }
          );
        }, 300);
      }
    },
    [ilikeSearch, semanticSearch, searchType, searchScope]
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
        // Check raw names and canonical names from matched_people
        const matchedMap = new Map<string, string>();
        if (Array.isArray(meta?.matched_people)) {
          for (const m of meta.matched_people as Array<{ name: string; canonical_name: string }>) {
            matchedMap.set(m.name.toLowerCase(), m.canonical_name);
          }
        }
        return people.some((p) => {
          const canonical = matchedMap.get(p.toLowerCase()) || p;
          return canonical === personFilter || p === personFilter;
        });
      });
    }
    if (metaTypeFilter) {
      notes = notes.filter((n) => {
        const meta = n.metadata as Record<string, unknown> | null;
        return meta?.type === metaTypeFilter;
      });
    }
    if (folderFilter !== null) {
      notes = notes.filter((n) => (n.folder_path || "") === folderFilter);
    }
    // Sort: pinned first, then by selected field/direction
    const sorted = [...notes].sort((a, b) => {
      const aPinned = "is_pinned" in a && a.is_pinned ? 1 : 0;
      const bPinned = "is_pinned" in b && b.is_pinned ? 1 : 0;
      if (aPinned !== bPinned) return bPinned - aPinned;

      const dir = sortDirection === "asc" ? 1 : -1;
      if (sortField === "title") {
        return dir * (a.title || "").localeCompare(b.title || "");
      }
      const aVal = a[sortField] || "";
      const bVal = b[sortField] || "";
      return dir * aVal.localeCompare(bVal);
    });
    return sorted;
  }, [filter, allNotes, favNotes, trashNotes, searchMode, searchResults, entityFilter, topicFilter, personFilter, metaTypeFilter, folderFilter, sortField, sortDirection]);

  const selectedNote = useMemo(() => {
    if (!selectedId) return null;
    return (
      allNotes.find((n) => n.id === selectedId) ||
      trashNotes.find((n) => n.id === selectedId) ||
      favNotes.find((n) => n.id === selectedId) ||
      // Also check current search results (semantic/ilike may return notes not yet in cache)
      (searchResults ?? []).find((n) => n.id === selectedId) ||
      null
    );
  }, [selectedId, allNotes, trashNotes, favNotes, searchResults]);

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

  // Vault insights aggregation
  const TYPE_LABELS: Record<string, string> = {
    observation: "Observation", task: "Task", idea: "Idea", reference: "Reference",
    person_note: "Person Note", meeting_note: "Meeting Note", decision: "Decision", project: "Project",
  };
  const TYPE_COLORS: Record<string, string> = {
    observation: "bg-slate-500/15 text-slate-600 dark:text-slate-400",
    task: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
    idea: "bg-violet-500/15 text-violet-700 dark:text-violet-400",
    reference: "bg-cyan-500/15 text-cyan-700 dark:text-cyan-400",
    person_note: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
    meeting_note: "bg-rose-500/15 text-rose-700 dark:text-rose-400",
    decision: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
    project: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-400",
  };

  const { topicCounts, peopleCounts, typeCounts, unclassifiedCount } = useMemo(() => {
    const topics: Record<string, number> = {};
    const people: Record<string, number> = {};
    const types: Record<string, number> = {};
    let unclassified = 0;
    for (const note of allNotes) {
      const meta = note.metadata as Record<string, unknown> | null;
      if (!meta || !meta.type) { unclassified++; continue; }
      if (Array.isArray(meta.topics)) for (const t of meta.topics as string[]) topics[t] = (topics[t] || 0) + 1;
      // Normalize people names: use canonical_name from matched_people when available
      const matchedMap = new Map<string, string>();
      if (Array.isArray(meta.matched_people)) {
        for (const m of meta.matched_people as Array<{ name: string; canonical_name: string }>) {
          matchedMap.set(m.name.toLowerCase(), m.canonical_name);
        }
      }
      if (Array.isArray(meta.people)) {
        for (const p of meta.people as string[]) {
          const canonical = matchedMap.get(p.toLowerCase()) || p;
          people[canonical] = (people[canonical] || 0) + 1;
        }
      }
      if (typeof meta.type === "string") types[meta.type] = (types[meta.type] || 0) + 1;
    }
    return {
      topicCounts: Object.entries(topics).sort((a, b) => b[1] - a[1]),
      peopleCounts: Object.entries(people).sort((a, b) => b[1] - a[1]),
      typeCounts: Object.entries(types).sort((a, b) => b[1] - a[1]),
      unclassifiedCount: unclassified,
    };
  }, [allNotes]);

  const [isBackfilling, setIsBackfilling] = useState(false);
  const handleBackfill = useCallback(async () => {
    setIsBackfilling(true);
    try {
      const res = await supabase.functions.invoke("backfill-metadata", { body: {} });
      if (res.error) throw res.error;
      const data = res.data as { processed: number; total: number; message: string };
      showToast.success(data.message);
    } catch (err: any) {
      showToast.error(err.message || "Backfill failed");
    } finally {
      setIsBackfilling(false);
    }
  }, []);

  return (
    <div className="flex h-[calc(100vh-56px)] overflow-hidden">
      <SEOHead title="Notes — Menerio" noIndex />


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
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                title="Sort notes"
              >
                <ArrowUpDown className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-44">
              {(Object.keys(sortLabels) as SortField[]).map((field) => (
                <DropdownMenuItem
                  key={field}
                  onClick={() => {
                    if (sortField === field) {
                      setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
                    } else {
                      setSortField(field);
                      setSortDirection(defaultDirections[field]);
                    }
                  }}
                  className="gap-2"
                >
                  {sortField === field ? (
                    sortDirection === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
                  ) : (
                    <span className="w-3" />
                  )}
                  <span className="flex-1">{sortLabels[field]}</span>
                  {sortField === field && <Check className="h-3 w-3" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Tags / Vault Insights popover */}
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant={hasActiveMetaFilter ? "secondary" : "ghost"}
                size="icon"
                className="h-8 w-8"
                title="Tags & Insights"
              >
                <Hash className="h-4 w-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-72 p-0 max-h-[70vh] overflow-hidden">
              <ScrollArea className="max-h-[70vh]">
                <div className="p-3 space-y-1">
                  {/* By Type */}
                  <VaultSection label="By Type" icon={LayoutGrid} defaultOpen>
                    <div className="flex flex-wrap gap-1">
                      {typeCounts.map(([type, count]) => (
                        <button
                          key={type}
                          onClick={() => setMetaTypeFilter(metaTypeFilter === type ? null : type)}
                          className={cn(
                            "text-[10px] px-2 py-1 rounded-full font-medium transition-all",
                            TYPE_COLORS[type] || "bg-muted text-muted-foreground",
                            metaTypeFilter === type && "ring-2 ring-primary ring-offset-1 ring-offset-background"
                          )}
                        >
                          {TYPE_LABELS[type] || type} ({count})
                        </button>
                      ))}
                      {typeCounts.length === 0 && (
                        <p className="text-[10px] text-muted-foreground">No classified notes yet</p>
                      )}
                    </div>
                  </VaultSection>

                  <Separator />

                  {/* Topics */}
                  <VaultSection label="Topics" icon={Hash} defaultOpen>
                    <div className="flex flex-wrap gap-1">
                      {topicCounts.slice(0, 30).map(([topic, count]) => (
                        <button
                          key={topic}
                          onClick={() => setTopicFilter(topicFilter === topic ? null : topic)}
                          className={cn(
                            "text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium transition-all hover:bg-primary/20",
                            topicFilter === topic && "ring-2 ring-primary ring-offset-1 ring-offset-background bg-primary/20"
                          )}
                        >
                          {topic} <span className="opacity-60">{count}</span>
                        </button>
                      ))}
                      {topicCounts.length === 0 && (
                        <p className="text-[10px] text-muted-foreground">No topics extracted yet</p>
                      )}
                    </div>
                  </VaultSection>

                  <Separator />

                  {/* People */}
                  <VaultSection label="People" icon={User}>
                    <div className="space-y-0.5">
                      {peopleCounts.slice(0, 20).map(([person, count]) => (
                        <button
                          key={person}
                          onClick={() => setPersonFilter(personFilter === person ? null : person)}
                          className={cn(
                            "flex items-center gap-2 w-full text-left px-2 py-1 rounded-md text-xs hover:bg-accent/50 transition-colors",
                            personFilter === person && "bg-accent"
                          )}
                        >
                          <User className="h-3 w-3 text-violet-500 shrink-0" />
                          <span className="flex-1 truncate">{person}</span>
                          <span className="text-[10px] text-muted-foreground">{count}</span>
                        </button>
                      ))}
                      {peopleCounts.length === 0 && (
                        <p className="text-[10px] text-muted-foreground px-2">No people mentioned yet</p>
                      )}
                    </div>
                  </VaultSection>

                  {/* Classify button */}
                  {unclassifiedCount > 0 && (
                    <>
                      <Separator />
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full gap-1.5 text-xs h-8"
                        onClick={handleBackfill}
                        disabled={isBackfilling}
                      >
                        {isBackfilling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                        Classify unclassified vault notes ({unclassifiedCount})
                      </Button>
                    </>
                  )}
                </div>
              </ScrollArea>
            </PopoverContent>
          </Popover>

          <div className="flex-1" />
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

              {/* Search scope — only visible in semantic mode */}
              {searchType === "semantic" && (
                <>
                  <span className="text-muted-foreground/40 text-[10px]">|</span>
                  {(["all", "notes", "media"] as SearchScope[]).map((s) => (
                    <Button
                      key={s}
                      variant={searchScope === s ? "secondary" : "ghost"}
                      size="sm"
                      className="h-6 px-2 text-[10px] gap-1"
                      onClick={() => {
                        setSearchScope(s);
                        setSemanticResults(null);
                        if (searchQuery.trim()) {
                          semanticSearch.mutate(
                            { query: searchQuery, scope: s },
                            { onSuccess: (data) => setSemanticResults(data.results as SemanticSearchResult[]) }
                          );
                        }
                      }}
                    >
                      {s === "media" && <Image className="h-3 w-3" />}
                      {s === "notes" && <FileText className="h-3 w-3" />}
                      {s === "all" && <Search className="h-3 w-3" />}
                      {s === "all" ? "All" : s === "notes" ? "Notes" : "Media"}
                    </Button>
                  ))}
                </>
              )}

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
            showLocalGraph={showLocalGraph}
            onToggleLocalGraph={() => setShowLocalGraph(prev => !prev)}
            onNoteSelect={selectNote}
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-center p-8">
            <div className="mb-4">
              <img src="/favicon.png" alt="Menerio" className="h-16 w-16 object-contain" />
            </div>
            <h3 className="text-lg font-semibold font-display mb-2">
              Your Open Knowledge System
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

function VaultSection({ label, icon: Icon, defaultOpen = false, children }: { label: string; icon: any; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex items-center gap-1.5 w-full py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors">
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        <Icon className="h-3.5 w-3.5" />
        <span>{label}</span>
      </CollapsibleTrigger>
      <CollapsibleContent className="pb-1">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}
