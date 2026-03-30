import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface GitHubConnection {
  id: string;
  user_id: string;
  github_token: string;
  github_username: string | null;
  repo_owner: string | null;
  repo_name: string | null;
  branch: string;
  vault_path: string;
  sync_enabled: boolean;
  sync_direction: string;
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
        .select("*")
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
      return res.data as { total: number; succeeded: number; failed: number; results: any[] };
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
      // Get the sync log to find the file path
      const { data: syncLog } = await supabase
        .from("github_sync_log" as any)
        .select("github_path")
        .eq("user_id", user!.id)
        .eq("note_id", noteId!)
        .maybeSingle();

      if (!syncLog?.github_path) return [];

      // Get GitHub connection
      const { data: conn } = await supabase
        .from("github_connections" as any)
        .select("github_token, repo_owner, repo_name, branch")
        .eq("user_id", user!.id)
        .maybeSingle();

      if (!conn) return [];

      const res = await fetch(
        `https://api.github.com/repos/${conn.repo_owner}/${conn.repo_name}/commits?path=${encodeURIComponent(syncLog.github_path)}&sha=${conn.branch}&per_page=30`,
        { headers: { Authorization: `token ${conn.github_token}`, Accept: "application/vnd.github.v3+json" } }
      );

      if (!res.ok) return [];
      return await res.json();
    },
    staleTime: 30_000,
  });
}

export function useGitHubFileAtCommit() {
  return useMutation({
    mutationFn: async ({ path, commitSha }: { path: string; commitSha: string }) => {
      // Need connection details
      const { data: conn } = await supabase
        .from("github_connections" as any)
        .select("github_token, repo_owner, repo_name")
        .maybeSingle();

      if (!conn) throw new Error("No GitHub connection");

      const res = await fetch(
        `https://api.github.com/repos/${conn.repo_owner}/${conn.repo_name}/contents/${encodeURIComponent(path)}?ref=${commitSha}`,
        { headers: { Authorization: `token ${conn.github_token}`, Accept: "application/vnd.github.v3+json" } }
      );

      if (!res.ok) throw new Error("Failed to fetch file");
      const data = await res.json();
      // GitHub returns base64 content
      return decodeURIComponent(escape(atob(data.content.replace(/\n/g, ""))));
    },
  });
}
