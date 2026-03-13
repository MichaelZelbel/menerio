import { useState, useMemo, useEffect } from "react";
import { SEOHead } from "@/components/SEOHead";
import { useNotes, useCreateNote, useSearchNotes, Note } from "@/hooks/useNotes";
import { NoteList } from "@/components/notes/NoteList";
import { NoteEditor } from "@/components/notes/NoteEditor";
import { NoteSidebar, NoteFilter } from "@/components/notes/NoteSidebar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, Search, X, Brain, PanelLeftClose, PanelLeft } from "lucide-react";
import { useSearchParams } from "react-router-dom";
export default function Notes() {
  const [filter, setFilter] = useState<NoteFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searchMode, setSearchMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const { data: allNotes = [], isLoading: loadingAll } = useNotes("all");
  const { data: favNotes = [] } = useNotes("favorites");
  const { data: trashNotes = [] } = useNotes("trash");
  const createNote = useCreateNote();
  const searchNotes = useSearchNotes();

  const currentNotes = useMemo(() => {
    if (searchMode && searchNotes.data) return searchNotes.data;
    if (filter === "favorites") return favNotes;
    if (filter === "trash") return trashNotes;
    return allNotes;
  }, [filter, allNotes, favNotes, trashNotes, searchMode, searchNotes.data]);

  const selectedNote = useMemo(() => {
    if (!selectedId) return null;
    // Search across all lists
    return (
      allNotes.find((n) => n.id === selectedId) ||
      trashNotes.find((n) => n.id === selectedId) ||
      favNotes.find((n) => n.id === selectedId) ||
      null
    );
  }, [selectedId, allNotes, trashNotes, favNotes]);

  const handleCreate = async () => {
    const note = await createNote.mutateAsync({ title: "", content: "" });
    setFilter("all");
    setSearchMode(false);
    setSelectedId(note.id);
  };

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

      {/* Left sidebar — filters */}
      {sidebarOpen && (
        <div className="w-56 shrink-0 border-r border-border hidden md:block">
          <NoteSidebar
            filter={filter}
            onFilterChange={(f) => {
              setFilter(f);
              setSearchMode(false);
            }}
            counts={{
              all: allNotes.length,
              favorites: favNotes.length,
              trash: trashNotes.length,
            }}
            onSearchToggle={() => setSearchMode(!searchMode)}
            searchActive={searchMode}
          />
        </div>
      )}

      {/* Middle panel — note list */}
      <div className="w-72 shrink-0 border-r border-border flex flex-col bg-background">
        {/* Header */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border shrink-0">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 hidden md:flex"
            onClick={() => setSidebarOpen(!sidebarOpen)}
          >
            {sidebarOpen ? (
              <PanelLeftClose className="h-4 w-4" />
            ) : (
              <PanelLeft className="h-4 w-4" />
            )}
          </Button>
          <h3 className="text-sm font-semibold flex-1">
            {searchMode ? "Search Results" : filter === "all" ? "All Notes" : filter === "favorites" ? "Favorites" : "Trash"}
          </h3>
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

      {/* Right panel — editor */}
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
