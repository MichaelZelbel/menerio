import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Link2, ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import { formatDistanceToNow } from "date-fns";

interface BacklinksPanelProps {
  noteId: string;
  onNavigate: (noteId: string) => void;
}

interface Backlink {
  id: string;
  title: string;
  content: string;
  updated_at: string;
}

export function BacklinksPanel({ noteId, onNavigate }: BacklinksPanelProps) {
  const { user } = useAuth();
  const [expanded, setExpanded] = useState(true);

  const { data: backlinks = [], isLoading } = useQuery<Backlink[]>({
    queryKey: ["backlinks", noteId, user?.id],
    enabled: !!user && !!noteId,
    queryFn: async () => {
      // Find notes that have manual_link connections targeting this note
      const { data: connections } = await supabase
        .from("note_connections" as any)
        .select("source_note_id")
        .eq("target_note_id", noteId)
        .eq("connection_type", "manual_link")
        .eq("user_id", user!.id);

      if (!connections || connections.length === 0) return [];

      const sourceIds = connections.map((c: any) => c.source_note_id);
      const { data: notes } = await supabase
        .from("notes" as any)
        .select("id, title, content, updated_at")
        .in("id", sourceIds)
        .eq("is_trashed", false);

      return (notes || []) as unknown as Backlink[];
    },
  });

  const count = backlinks.length;

  return (
    <div className="border-t border-border">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 px-4 py-2 w-full text-left text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
      >
        {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        <Link2 className="h-3 w-3" />
        Backlinks ({count})
      </button>

      {expanded && (
        <div className="px-4 pb-3 space-y-1.5">
          {isLoading && (
            <p className="text-[10px] text-muted-foreground">Loading…</p>
          )}
          {!isLoading && count === 0 && (
            <p className="text-[10px] text-muted-foreground">
              No notes link to this one yet. Use [[wikilinks]] in other notes to create connections.
            </p>
          )}
          {backlinks.map((bl) => {
            // Extract a context snippet containing the wikilink
            const snippet = extractSnippet(bl.content, noteId);
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
