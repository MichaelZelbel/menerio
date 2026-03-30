import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useGraphData } from "@/hooks/useGraphData";
import { useNotes } from "@/hooks/useNotes";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  FileText,
  Sparkles,
  Ban,
  Loader2,
  ArrowRight,
} from "lucide-react";
import { getNotePreviewText } from "@/lib/note-content";
import { showToast } from "@/lib/toast";
import { useQueryClient } from "@tanstack/react-query";

interface OrphanNotesDetectorProps {
  compact?: boolean;
}

export function OrphanNotesDetector({ compact }: OrphanNotesDetectorProps) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { data: graphData } = useGraphData({ limit: 500 });
  const { data: notes = [] } = useNotes("all");
  const [computing, setComputing] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const orphanNotes = useMemo(() => {
    if (!graphData || !notes.length) return [];
    const connectedIds = new Set<string>();
    for (const e of graphData.edges) {
      connectedIds.add(e.source);
      connectedIds.add(e.target);
    }
    // Also consider notes in graph nodes that have connections
    return notes
      .filter((n) => !n.is_trashed && !connectedIds.has(n.id) && !dismissed.has(n.id))
      .slice(0, compact ? 5 : 50);
  }, [graphData, notes, dismissed, compact]);

  const totalOrphans = orphanNotes.length;

  const handleFindConnections = async (noteId: string) => {
    setComputing(noteId);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      await supabase.functions.invoke("compute-connections", {
        body: { note_id: noteId },
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      queryClient.invalidateQueries({ queryKey: ["graph-data"] });
      showToast.success("Connections computed");
    } catch {
      showToast.error("Failed to compute connections");
    } finally {
      setComputing(null);
    }
  };

  const handleMarkStandalone = (noteId: string) => {
    setDismissed((prev) => new Set(prev).add(noteId));
    showToast.success("Marked as standalone");
  };

  if (totalOrphans === 0) return null;

  if (compact) {
    return (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-base">Orphan Notes</CardTitle>
          <Badge variant="secondary" className="text-xs">
            {totalOrphans}
          </Badge>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground mb-3">
            {totalOrphans} note{totalOrphans !== 1 ? "s" : ""} with zero connections — consider linking them.
          </p>
          <div className="space-y-1.5">
            {orphanNotes.slice(0, 3).map((note) => (
              <button
                key={note.id}
                onClick={() => navigate(`/dashboard/notes/${note.id}`)}
                className="w-full text-left flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-accent transition-colors text-xs"
              >
                <FileText className="h-3 w-3 text-muted-foreground shrink-0" />
                <span className="truncate flex-1">{note.title || "Untitled"}</span>
                <ArrowRight className="h-3 w-3 text-muted-foreground" />
              </button>
            ))}
          </div>
          {totalOrphans > 3 && (
            <Button
              variant="ghost"
              size="sm"
              className="w-full mt-2 text-xs"
              onClick={() => navigate("/dashboard/graph")}
            >
              View all {totalOrphans} orphans
            </Button>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">
          Orphan Notes ({totalOrphans})
        </h3>
        <p className="text-xs text-muted-foreground">
          Notes with zero connections
        </p>
      </div>
      <ScrollArea className="max-h-[500px]">
        <div className="space-y-2">
          {orphanNotes.map((note) => {
            const preview = getNotePreviewText(note.content);
            const meta = note.metadata as Record<string, unknown> | null;
            const type = typeof meta?.type === "string" ? meta.type : null;
            return (
              <Card key={note.id} className="p-3">
                <div className="flex items-start gap-3">
                  <FileText className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <button
                      onClick={() => navigate(`/dashboard/notes/${note.id}`)}
                      className="text-sm font-medium text-foreground hover:text-primary truncate block"
                    >
                      {note.title || "Untitled"}
                    </button>
                    <p className="text-xs text-muted-foreground truncate mt-0.5">
                      {preview}
                    </p>
                    {type && (
                      <Badge variant="secondary" className="text-[9px] mt-1">
                        {type.replace("_", " ")}
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs gap-1"
                      onClick={() => handleFindConnections(note.id)}
                      disabled={computing === note.id}
                    >
                      {computing === note.id ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Sparkles className="h-3 w-3" />
                      )}
                      Find
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs gap-1"
                      onClick={() => handleMarkStandalone(note.id)}
                    >
                      <Ban className="h-3 w-3" />
                      Standalone
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
