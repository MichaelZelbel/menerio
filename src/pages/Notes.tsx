import { useState, useMemo, useEffect, useCallback } from "react";
import { SEOHead } from "@/components/SEOHead";
import { useNotes, useCreateNote, useSearchNotes, Note } from "@/hooks/useNotes";
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
  Plus,
  Search,
  X,
  Brain,
  FileText,
  Star,
  Trash2,
  ChevronDown,
  Filter,
} from "lucide-react";
import { useSearchParams } from "react-router-dom";

const filterConfig: { key: NoteFilter; label: string; icon: typeof FileText }[] = [
  { key: "all", label: "All Notes", icon: FileText },
  { key: "favorites", label: "Favorites", icon: Star },
  { key: "trash", label: "Trash", icon: Trash2 },
];

export default function Notes() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [filter, setFilter] = useState<NoteFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searchMode, setSearchMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [entityFilter, setEntityFilter] = useState<string | null>(null);

  const { data: allNotes = [], isLoading: loadingAll } = useNotes("all");
  const { data: favNotes = [] } = useNotes("favorites");
  const { data: trashNotes = [] } = useNotes("trash");
  const createNote = useCreateNote();
  const searchNotes = useSearchNotes();

  const handleCreate = useCallback(async () => {
    const note = await createNote.mutateAsync({ title: "", content: "" });
    setFilter("all");
    setSearchMode(false);
    setSelectedId(note.id);
  }, [createNote]);

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

  const currentNotes = useMemo(() => {
    let notes: Note[];
    if (searchMode && searchNotes.data) notes = searchNotes.data;
    else if (filter === "favorites") notes = favNotes;
    else if (filter === "trash") notes = trashNotes;
    else notes = allNotes;

    if (entityFilter) {
      notes = notes.filter((n) => n.entity_type === entityFilter);
    }
    return notes;
  }, [filter, allNotes, favNotes, trashNotes, searchMode, searchNotes.data, entityFilter]);

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

  const handleSearch = (q: string) => {
    setSearchQuery(q);
    if (q.trim()) {
      searchNotes.mutate(q);
    }
  };

  const exitSearch = () => {
    setSearchMode(false);
    setSearchQuery("");
  };

  return (
    <div className="flex h-[calc(100vh-56px)] overflow-hidden">
      <SEOHead title="Notes — Menerio" noIndex />

      {/* Note list panel — with integrated filters */}
      <div className="w-72 shrink-0 border-r border-border flex flex-col bg-background">
        {/* Header with filter dropdown */}
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
                  onClick={() => {
                    setFilter(f.key);
                    setSearchMode(false);
                  }}
                  className="gap-2"
                >
                  <f.icon className="h-4 w-4" />
                  <span className="flex-1">{f.label}</span>
                  <span className="text-[10px] text-muted-foreground">{counts[f.key]}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Entity type filter */}
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
          <div className="px-3 py-2 border-b border-border shrink-0">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(e) => handleSearch(e.target.value)}
                placeholder="Search notes…"
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
            onSelect={setSelectedId}
          />
        )}
      </div>

      {/* Right panel — editor (now gets much more space) */}
      <div className="flex-1 min-w-0">
        {selectedNote ? (
          <NoteEditor
            key={selectedNote.id}
            note={selectedNote}
            onNoteDeleted={() => setSelectedId(null)}
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
