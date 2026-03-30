import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  ArrowRight,
  Loader2,
  GitCompare,
} from "lucide-react";
import { showToast } from "@/lib/toast";

interface ConflictEntry {
  id: string;
  note_id: string;
  github_path: string;
  github_sha: string | null;
  error_message: string | null;
  synced_at: string;
  notes: {
    id: string;
    title: string;
    content: string;
    updated_at: string;
  };
}

export function SyncConflictsPanel() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const { data: conflicts = [], isLoading, refetch } = useQuery<ConflictEntry[]>({
    queryKey: ["github-sync-conflicts", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("github-sync-pull", {
        body: { action: "get-conflicts" },
      });
      if (error) throw error;
      return (data?.conflicts || []) as ConflictEntry[];
    },
    staleTime: 30_000,
  });

  const resolveMutation = useMutation({
    mutationFn: async ({ noteId, resolution }: { noteId: string; resolution: string }) => {
      const { data, error } = await supabase.functions.invoke("github-sync-pull", {
        body: { action: "resolve-conflict", note_id: noteId, resolution },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      refetch();
      qc.invalidateQueries({ queryKey: ["github-sync-log"] });
      qc.invalidateQueries({ queryKey: ["notes"] });
      showToast.success("Conflict resolved");
    },
    onError: () => showToast.error("Failed to resolve conflict"),
  });

  const resolveAllMutation = useMutation({
    mutationFn: async (resolution: string) => {
      for (const conflict of conflicts) {
        await supabase.functions.invoke("github-sync-pull", {
          body: { action: "resolve-conflict", note_id: conflict.note_id, resolution },
        });
      }
    },
    onSuccess: () => {
      refetch();
      qc.invalidateQueries({ queryKey: ["github-sync-log"] });
      qc.invalidateQueries({ queryKey: ["notes"] });
      showToast.success("All conflicts resolved");
    },
    onError: () => showToast.error("Failed to resolve conflicts"),
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (conflicts.length === 0) return null;

  return (
    <Card className="border-warning/50">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <GitCompare className="h-4 w-4 text-warning" />
          Sync Conflicts
          <Badge variant="destructive" className="ml-auto">{conflicts.length}</Badge>
        </CardTitle>
        <CardDescription>
          These notes were edited in both Menerio and GitHub since the last sync.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Bulk actions */}
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={resolveAllMutation.isPending}
            onClick={() => resolveAllMutation.mutate("keep_local")}
          >
            {resolveAllMutation.isPending && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
            Keep all Menerio
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={resolveAllMutation.isPending}
            onClick={() => resolveAllMutation.mutate("keep_remote")}
          >
            Keep all GitHub
          </Button>
        </div>

        <Separator />

        <ScrollArea className="max-h-[400px]">
          <div className="space-y-3">
            {conflicts.map((conflict) => (
              <div key={conflict.id} className="border rounded-lg p-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium text-sm truncate">{conflict.notes.title}</p>
                    <p className="text-xs text-muted-foreground truncate">{conflict.github_path}</p>
                  </div>
                  <AlertTriangle className="h-4 w-4 text-warning shrink-0" />
                </div>

                <div className="flex flex-wrap gap-1.5">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs gap-1"
                    disabled={resolveMutation.isPending}
                    onClick={() => resolveMutation.mutate({ noteId: conflict.note_id, resolution: "keep_local" })}
                  >
                    <ArrowRight className="h-3 w-3" />
                    Keep Menerio
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs gap-1"
                    disabled={resolveMutation.isPending}
                    onClick={() => resolveMutation.mutate({ noteId: conflict.note_id, resolution: "keep_remote" })}
                  >
                    <ArrowRight className="h-3 w-3 rotate-180" />
                    Keep GitHub
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs gap-1"
                    disabled={resolveMutation.isPending}
                    onClick={() => resolveMutation.mutate({ noteId: conflict.note_id, resolution: "keep_both" })}
                  >
                    <Copy className="h-3 w-3" />
                    Keep Both
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

export function useSyncConflictCount() {
  const { user } = useAuth();
  return useQuery<number>({
    queryKey: ["github-sync-conflict-count", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await (supabase.from("github_sync_log" as any)
        .select("id", { count: "exact", head: true })
        .eq("user_id", user!.id)
        .eq("sync_status", "conflict")) as any;
      if (error) return 0;
      return data?.length ?? 0;
    },
    staleTime: 30_000,
  });
}
