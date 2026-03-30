import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Link2, X, Loader2, ChevronDown, ChevronRight } from "lucide-react";

interface SuggestedLinksPanelProps {
  noteId: string;
  onInsertWikilink: (noteId: string, title: string) => void;
}

interface Suggestion {
  note_id: string;
  note_title: string;
  reason: string;
  suggested_context: string;
  similarity: number;
}

export function SuggestedLinksPanel({ noteId, onInsertWikilink }: SuggestedLinksPanelProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [loadRequested, setLoadRequested] = useState(false);

  const { data, isLoading } = useQuery<{ suggestions: Suggestion[] }>({
    queryKey: ["suggested-connections", noteId],
    enabled: !!user && loadRequested,
    queryFn: async () => {
      const res = await supabase.functions.invoke("suggest-connections", {
        body: { note_id: noteId },
      });
      if (res.error) throw res.error;
      return res.data;
    },
    staleTime: 5 * 60_000,
  });

  const dismissMutation = useMutation({
    mutationFn: async (targetNoteId: string) => {
      const { error } = await supabase
        .from("dismissed_suggestions" as any)
        .insert({
          user_id: user!.id,
          source_note_id: noteId,
          target_note_id: targetNoteId,
        });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["suggested-connections", noteId] });
    },
  });

  const suggestions = data?.suggestions || [];

  const handleExpand = () => {
    if (!loadRequested) setLoadRequested(true);
    setExpanded(!expanded);
  };

  return (
    <div className="border-t border-border">
      <button
        onClick={handleExpand}
        className="flex items-center gap-1.5 px-4 py-2 w-full text-left text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
      >
        {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        <Sparkles className="h-3 w-3" />
        Suggested Links
        {suggestions.length > 0 && (
          <Badge variant="secondary" className="text-[9px] px-1 py-0 ml-1">
            {suggestions.length}
          </Badge>
        )}
      </button>

      {expanded && (
        <div className="px-4 pb-3 space-y-2">
          {isLoading && (
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground py-2">
              <Loader2 className="h-3 w-3 animate-spin" />
              Analyzing connections…
            </div>
          )}
          {!isLoading && suggestions.length === 0 && (
            <p className="text-[10px] text-muted-foreground">
              No suggestions right now. Add more content or notes for the AI to find connections.
            </p>
          )}
          {suggestions.map((s) => (
            <div
              key={s.note_id}
              className="p-2 rounded-md bg-muted/30 border border-border/50"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-foreground truncate">
                    {s.note_title}
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {s.reason}
                  </p>
                  {s.suggested_context && (
                    <Badge variant="outline" className="text-[9px] mt-1 px-1 py-0">
                      {s.suggested_context}
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => onInsertWikilink(s.note_id, s.note_title)}
                    title="Link this note"
                  >
                    <Link2 className="h-3 w-3 text-primary" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => dismissMutation.mutate(s.note_id)}
                    title="Dismiss suggestion"
                  >
                    <X className="h-3 w-3 text-muted-foreground" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
