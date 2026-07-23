import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { ArrowUpRight, ChevronDown, ChevronRight } from "lucide-react";
import { useState, useEffect } from "react";
import { formatDistanceToNow } from "date-fns";

interface OutgoingLinksPanelProps {
  noteId: string;
  onNavigate: (noteId: string) => void;
}

interface OutgoingLink {
  id: string;
  title: string;
  updated_at: string;
}

export function OutgoingLinksPanel({ noteId, onNavigate }: OutgoingLinksPanelProps) {
  const { user } = useAuth();
  const [expanded, setExpanded] = useState(false);
  // Reset on note switch — NoteEditor reuses this instance (no `key`
  // remount, which caused a duplication glitch). Do not remove.
  useEffect(() => { setExpanded(false); }, [noteId]);

  const { data: links = [], isLoading } = useQuery<OutgoingLink[]>({
    queryKey: ["outgoing-links", noteId, user?.id],
    enabled: !!user && !!noteId,
    queryFn: async () => {
      const { data: connections } = await supabase
        .from("note_connections" as any)
        .select("target_note_id")
        .eq("source_note_id", noteId)
        .eq("connection_type", "manual_link")
        .eq("user_id", user!.id);

      if (!connections || connections.length === 0) return [];

      const targetIds = Array.from(
        new Set((connections as any[]).map((c) => c.target_note_id))
      );
      const { data: notes } = await supabase
        .from("notes" as any)
        .select("id, title, updated_at")
        .in("id", targetIds)
        .eq("is_trashed", false);

      return (notes || []) as unknown as OutgoingLink[];
    },
  });

  const count = links.length;

  return (
    <div className="border-t border-border">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 px-4 py-2 w-full text-left text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
      >
        {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        <ArrowUpRight className="h-3 w-3" />
        Links ({count})
      </button>

      {expanded && (
        <div className="px-4 pb-3 space-y-1.5">
          {isLoading && (
            <p className="text-[10px] text-muted-foreground">Loading…</p>
          )}
          {!isLoading && count === 0 && (
            <p className="text-[10px] text-muted-foreground">
              This note doesn't link to any other notes yet. Use [[wikilinks]] in the editor to create connections.
            </p>
          )}
          {links.map((ln) => (
            <button
              key={ln.id}
              onClick={() => onNavigate(ln.id)}
              className="w-full text-left p-2 rounded-md bg-muted/30 hover:bg-muted/60 transition-colors group"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-foreground group-hover:text-primary truncate">
                  {ln.title || "Untitled"}
                </span>
                <span className="text-[9px] text-muted-foreground shrink-0 ml-2">
                  {formatDistanceToNow(new Date(ln.updated_at), { addSuffix: true })}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
