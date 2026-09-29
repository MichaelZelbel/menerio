import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Link2, ChevronDown, ChevronRight } from "lucide-react";
import { useStickyPanelPreference } from "@/hooks/useStickyPanelPreference";
import { formatDistanceToNow } from "date-fns";
import { dbErrorMessage } from "@/lib/function-error";

interface BacklinksPanelProps {
  noteId: string;
  onNavigate: (noteId: string) => void;
}

interface Backlink {
  id: string;
  title: string;
  updated_at: string;
}

export function BacklinksPanel({ noteId, onNavigate }: BacklinksPanelProps) {
  const { user } = useAuth();
  const [expanded, setExpanded] = useStickyPanelPreference("note-backlinks");


  // The list (title and date) feeds the count in the header, so it loads even
  // while the panel is collapsed. The note bodies it takes to cut a snippet
  // are fetched below, only once the panel is open.
  const { data: backlinks = [], isLoading, error } = useQuery<Backlink[]>({
    queryKey: ["backlinks", noteId, user?.id],
    enabled: !!user && !!noteId,
    queryFn: async () => {
      // Find notes that have manual_link connections targeting this note
      const { data: connections, error: connectionsError } = await supabase
        .from("note_connections" as any)
        .select("source_note_id")
        .eq("target_note_id", noteId)
        .eq("connection_type", "manual_link")
        .eq("user_id", user!.id);
      if (connectionsError) throw connectionsError;

      if (!connections || connections.length === 0) return [];

      const sourceIds = connections.map((c: any) => c.source_note_id);
      const { data: notes, error: notesError } = await supabase
        .from("notes" as any)
        .select("id, title, updated_at")
        .in("id", sourceIds)
        .eq("is_trashed", false);
      if (notesError) throw notesError;

      return (notes || []) as unknown as Backlink[];
    },
  });

  const count = backlinks.length;
  const sourceIds = backlinks.map((bl) => bl.id);

  const { data: snippets } = useQuery<Record<string, string>>({
    queryKey: ["backlinks", noteId, user?.id, "snippets", sourceIds],
    enabled: expanded && !!user && sourceIds.length > 0,
    queryFn: async () => {
      const { data, error: contentError } = await supabase
        .from("notes")
        .select("id, content")
        .in("id", sourceIds)
        .eq("user_id", user!.id);
      if (contentError) throw contentError;
      const out: Record<string, string> = {};
      for (const row of (data || []) as unknown as { id: string; content: string | null }[]) {
        out[row.id] = extractSnippet(row.content ?? "", noteId);
      }
      return out;
    },
  });

  return (
    <div className="border-t border-border">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 px-4 py-2 w-full text-left text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
      >
        {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        <Link2 className="h-3 w-3" />
        {error ? "Backlinks" : `Backlinks (${count})`}
      </button>

      {expanded && (
        <div className="px-4 pb-3 space-y-1.5">
          {isLoading && (
            <p className="text-[10px] text-muted-foreground">Loading…</p>
          )}
          {error && (
            <p role="alert" className="text-[10px] text-destructive">
              {dbErrorMessage(error, "Could not load the notes that link here.")}
            </p>
          )}
          {!isLoading && !error && count === 0 && (
            <p className="text-[10px] text-muted-foreground">
              No notes link to this one yet. Use [[wikilinks]] in other notes to create connections.
            </p>
          )}
          {backlinks.map((bl) => {
            // A context snippet containing the wikilink, once the bodies are in
            const snippet = snippets?.[bl.id];
            return (
              <button
                key={bl.id}
                onClick={() => onNavigate(bl.id)}
                className="w-full text-left p-2 rounded-md bg-muted/30 hover:bg-muted/60 transition-colors group"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-foreground group-hover:text-primary truncate">
                    {bl.title || "Untitled"}
                  </span>
                  <span className="text-[9px] text-muted-foreground shrink-0 ml-2">
                    {formatDistanceToNow(new Date(bl.updated_at), { addSuffix: true })}
                  </span>
                </div>
                {snippet && (
                  <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-2">
                    {snippet}
                  </p>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function extractSnippet(content: string, _noteId: string): string {
  // Try to find text around a wikilink reference
  const plainText = content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  // Look for [[...]] patterns
  const match = plainText.match(/\[\[[^\]]+\]\]/);
  if (match && match.index !== undefined) {
    const start = Math.max(0, match.index - 40);
    const end = Math.min(plainText.length, match.index + match[0].length + 40);
    return (start > 0 ? "…" : "") + plainText.slice(start, end) + (end < plainText.length ? "…" : "");
  }
  return plainText.slice(0, 100) + (plainText.length > 100 ? "…" : "");
}
