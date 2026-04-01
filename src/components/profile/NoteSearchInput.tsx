import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Input } from "@/components/ui/input";
import { FileText, X } from "lucide-react";

interface NoteSearchInputProps {
  selectedNoteId: string | null;
  selectedNoteTitle?: string;
  onSelect: (noteId: string | null, title: string | null) => void;
}

interface NoteResult {
  id: string;
  title: string;
}

export function NoteSearchInput({ selectedNoteId, selectedNoteTitle, onSelect }: NoteSearchInputProps) {
  const { user } = useAuth();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<NoteResult[]>([]);
  const [open, setOpen] = useState(false);
  const [resolvedTitle, setResolvedTitle] = useState(selectedNoteTitle ?? "");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (selectedNoteId && !resolvedTitle) {
      supabase
        .from("notes")
        .select("title")
        .eq("id", selectedNoteId)
        .single()
        .then(({ data }) => {
          if (data) setResolvedTitle(data.title);
        });
    }
  }, [selectedNoteId, resolvedTitle]);

  useEffect(() => {
    if (!query.trim() || !user?.id) {
      setResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      const { data } = await supabase
        .from("notes")
        .select("id, title")
        .eq("user_id", user.id)
        .ilike("title", `%${query}%`)
        .eq("is_trashed", false)
        .limit(8);
      setResults(data ?? []);
      setOpen(true);
    }, 250);
    return () => clearTimeout(timer);
  }, [query, user?.id]);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  if (selectedNoteId) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm">
        <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="truncate flex-1">{resolvedTitle || "Linked note"}</span>
        <button
          type="button"
          onClick={() => {
            onSelect(null, null);
            setResolvedTitle("");
          }}
          className="text-muted-foreground hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div ref={ref} className="relative">
      <Input
        placeholder="Search notes to link..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => results.length > 0 && setOpen(true)}
      />
      {open && results.length > 0 && (
        <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md max-h-48 overflow-auto">
          {results.map((n) => (
            <button
              key={n.id}
              type="button"
              className="w-full px-3 py-2 text-sm text-left hover:bg-accent flex items-center gap-2"
              onClick={() => {
                onSelect(n.id, n.title);
                setResolvedTitle(n.title);
                setQuery("");
                setOpen(false);
              }}
            >
              <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="truncate">{n.title}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
