import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Sparkles, Link2, X, Loader2 } from "lucide-react";
import { useNavigate } from "react-router-dom";

interface Discovery {
  source_note_id: string;
  source_note_title: string;
  target_note_id: string;
  target_note_title: string;
  similarity: number;
  reason: string;
}

export function DiscoveryFeed() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<{ discoveries: Discovery[] }>({
    queryKey: ["daily-discoveries", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const res = await supabase.functions.invoke("suggest-connections", {
        body: { mode: "daily" },
      });
      if (res.error) throw res.error;
      return res.data;
    },
    staleTime: 30 * 60_000,
  });

  const linkMutation = useMutation({
    mutationFn: async ({ sourceId, targetId, targetTitle }: { sourceId: string; targetId: string; targetTitle: string }) => {
      // Create manual_link connection in both directions
      await supabase.from("note_connections" as any).upsert([
        {
          user_id: user!.id,
          source_note_id: sourceId,
          target_note_id: targetId,
          connection_type: "manual_link",
          strength: 1.0,
          metadata: { auto_linked: true },
        },
        {
          user_id: user!.id,
          source_note_id: targetId,
          target_note_id: sourceId,
          connection_type: "manual_link",
          strength: 1.0,
          metadata: { auto_linked: true },
        },
      ], { onConflict: "source_note_id,target_note_id,connection_type" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["daily-discoveries"] });
      queryClient.invalidateQueries({ queryKey: ["note-connections"] });
    },
  });

  const dismissMutation = useMutation({
    mutationFn: async ({ sourceId, targetId }: { sourceId: string; targetId: string }) => {
      await supabase.from("dismissed_suggestions" as any).insert({
        user_id: user!.id,
        source_note_id: sourceId,
        target_note_id: targetId,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["daily-discoveries"] });
    },
  });

  const discoveries = data?.discoveries || [];

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            Daily Discoveries
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            Finding connections…
          </div>
        </CardContent>
      </Card>
    );
  }

  if (discoveries.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          Daily Discoveries
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {discoveries.map((d, i) => (
          <div key={i} className="p-3 rounded-lg bg-muted/30 border border-border/50">
            <p className="text-xs text-foreground">
              <button
                onClick={() => navigate(`/dashboard/notes/${d.source_note_id}`)}
                className="font-medium text-primary hover:underline"
              >
                {d.source_note_title}
              </button>
              {" and "}
              <button
                onClick={() => navigate(`/dashboard/notes/${d.target_note_id}`)}
                className="font-medium text-primary hover:underline"
              >
                {d.target_note_title}
              </button>
            </p>
            <p className="text-[10px] text-muted-foreground mt-1">{d.reason}</p>
            <div className="flex items-center gap-2 mt-2">
              <Button
                variant="outline"
                size="sm"
                className="h-6 text-[10px] gap-1"
                onClick={() => linkMutation.mutate({
                  sourceId: d.source_note_id,
                  targetId: d.target_note_id,
                  targetTitle: d.target_note_title,
                })}
                disabled={linkMutation.isPending}
              >
                <Link2 className="h-3 w-3" />
                Link these notes
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-[10px] gap-1 text-muted-foreground"
                onClick={() => dismissMutation.mutate({
                  sourceId: d.source_note_id,
                  targetId: d.target_note_id,
                })}
                disabled={dismissMutation.isPending}
              >
                <X className="h-3 w-3" />
                Not related
              </Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
