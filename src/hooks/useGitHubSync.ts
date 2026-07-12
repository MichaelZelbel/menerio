import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface GitHubConnection {
  id: string;
  user_id: string;
  github_username: string | null;
  repo_owner: string | null;
  repo_name: string | null;
  branch: string;
  vault_path: string;
  sync_enabled: boolean;
  sync_direction: string;
  sync_people: boolean;
  last_sync_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SyncLogEntry {
  id: string;
  note_id: string;
  github_path: string;
  github_sha: string | null;
  last_commit_sha: string | null;
  sync_status: string;
  sync_direction: string | null;
  error_message: string | null;
  synced_at: string;
}

export function useGitHubConnection() {
  const { user } = useAuth();
  return useQuery<GitHubConnection | null>({
    queryKey: ["github-connection", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("github_connections" as any)
        .select("id, user_id, github_username, repo_owner, repo_name, branch, vault_path, sync_enabled, sync_direction, sync_people, last_sync_at, created_at, updated_at")
        .eq("user_id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return data as unknown as GitHubConnection | null;
    },
  });
}

export function useSyncLogForNote(noteId: string | null) {
  const { user } = useAuth();
  return useQuery<SyncLogEntry | null>({
    queryKey: ["github-sync-log", noteId],
    enabled: !!user && !!noteId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("github_sync_log" as any)
        .select("*")
        .eq("user_id", user!.id)
        .eq("note_id", noteId!)
        .maybeSingle();
      if (error) throw error;
      return data as unknown as SyncLogEntry | null;
    },
  });
}

export function useGitHubSyncExport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ noteId, action }: { noteId: string; action: "create" | "update" | "delete" }) => {
      const res = await supabase.functions.invoke("github-sync-export", {
        body: { note_id: noteId, action },
      });
      if (res.error) throw res.error;
      return res.data;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["github-sync-log", vars.noteId] });
    },
  });
}

export function useGitHubBulkSync() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await supabase.functions.invoke("github-sync-export", {
        body: { bulk: true },
      });
      if (res.error) throw res.error;
      return res.data as { total: number; succeeded: number; failed: number; repository_created?: boolean; results: any[] };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["github-sync-log"] });
      qc.invalidateQueries({ queryKey: ["github-connection"] });
    },
  });
}

export function useGitHubVersionHistory(noteId: string | null) {
  const { user } = useAuth();
  return useQuery<any[]>({
    queryKey: ["github-versions", noteId],
    enabled: !!user && !!noteId,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("github-proxy", {
        body: { action: "version_history", note_id: noteId },
      });
      if (error) return [];
      return (data as any)?.commits || [];
    },
    staleTime: 30_000,
  });
}

export function useGitHubFileAtCommit() {
  return useMutation({
    mutationFn: async ({ path, commitSha }: { path: string; commitSha: string }) => {
      const { data, error } = await supabase.functions.invoke("github-proxy", {
        body: { action: "file_at_commit", path, commit_sha: commitSha },
      });
      if (error) throw error;
      const content = (data as any)?.content;
      if (typeof content !== "string") throw new Error("Failed to fetch file");
      return content;
    },
  });
}
