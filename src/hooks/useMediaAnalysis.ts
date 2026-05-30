import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface MediaAnalysisEntry {
  id: string;
  note_id: string;
  storage_path: string;
  media_type: string;
  page_number: number | null;
  original_filename: string | null;
  extracted_text: string | null;
  description: string | null;
  topics: string[] | null;
  raw_analysis: Record<string, unknown> | null;
  analysis_status: string;
  error_message: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export function useMediaAnalysis(noteId: string | undefined) {
  const { user } = useAuth();

  const query = useQuery({
    queryKey: ["media-analysis", noteId],
    queryFn: async () => {
      if (!noteId) return [];
      const { data, error } = await supabase
        .from("media_analysis")
        .select("*")
        .eq("note_id", noteId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data || []) as MediaAnalysisEntry[];
    },
    enabled: !!noteId && !!user,
    refetchInterval: (query) => {
      const entries = query.state.data;
      if (entries?.some((e: MediaAnalysisEntry) => e.analysis_status === "pending" || e.analysis_status === "processing")) {
        return 3000;
      }
      return false;
    },
  });

  return query;
}

export interface ReanalyzeVars {
  noteId: string;
  storagePath: string;
  mediaType: string;
  originalFilename?: string;
}

type AnalysisStatusLike = {
  storage_path: string;
  analysis_status: string;
  created_at?: string | null;
  updated_at?: string | null;
  error_message?: string | null;
};

const MAX_CLIENT_PENDING_MS = 5 * 60 * 1000;

/**
 * A retry job is considered finished only when:
 *  1) at least one row for this path has updated_at strictly AFTER the job started
 *     (proving the backend wrote a fresh result), AND
 *  2) none of the rows for this path are still in 'processing' or 'pending'.
 */
function isJobFinished(entries: AnalysisStatusLike[] | undefined, path: string, startedAt: number): boolean {
  if (!entries) return false;
  const rows = entries.filter((e) => e.storage_path === path);
  if (rows.length === 0) return false;

  const hasFresh = rows.some((e) => {
    // Use updated_at only — created_at stays old when rows are updated in place.
    const ts = Date.parse(e.updated_at || "");
    return Number.isFinite(ts) && ts >= startedAt - 1500;
  });
  if (!hasFresh) return false;

  const stillRunning = rows.some(
    (e) => e.analysis_status === "processing" || e.analysis_status === "pending",
  );
  return !stillRunning;
}

export function useReanalyzeMedia() {
  const queryClient = useQueryClient();
  const [pendingJobs, setPendingJobs] = useState<Record<string, number>>({});

  // Watch the query cache and clear pending jobs as soon as fresh DB results land,
  // or hard-timeout if nothing arrives within MAX_CLIENT_PENDING_MS.
  useEffect(() => {
    const evaluate = () => {
      setPendingJobs((prev) => {
        const entries = Object.entries(prev);
        if (entries.length === 0) return prev;
        const libraryCaches = queryClient.getQueriesData<AnalysisStatusLike[]>({ queryKey: ["media-library"] });
        const noteCaches = queryClient.getQueriesData<AnalysisStatusLike[]>({ queryKey: ["media-analysis"] });
        const allCaches = [...libraryCaches, ...noteCaches];

        let changed = false;
        const next: Record<string, number> = {};
        for (const [path, startedAt] of entries) {
          if (Date.now() - startedAt > MAX_CLIENT_PENDING_MS) {
            changed = true;
            continue;
          }
          const finished = allCaches.some(([, rows]) => isJobFinished(rows, path, startedAt));
          if (finished) {
            changed = true;
            continue;
          }
          next[path] = startedAt;
        }
        return changed ? next : prev;
      });
    };

    const unsub = queryClient.getQueryCache().subscribe(() => evaluate());
    // Safety net: re-evaluate every 2s to enforce the hard timeout even if no cache event fires.
    const interval = setInterval(evaluate, 2000);
    return () => {
      unsub();
      clearInterval(interval);
    };
  }, [queryClient]);

  const isPathPending = (path: string) => pendingJobs[path] != null;
  const hasActivePendingJobs = () => Object.keys(pendingJobs).length > 0;

  const mutation = useMutation({
    mutationFn: async ({ noteId, storagePath, mediaType, originalFilename }: ReanalyzeVars) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      // Always go directly through analyze-media so there is exactly one job
      // and one set of logs per retry. analyze-pdf was a thin wrapper that
      // only made the flow harder to observe.
      const { data, error } = await supabase.functions.invoke("analyze-media", {
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: {
          note_id: noteId,
          storage_path: storagePath,
          media_type: mediaType === "pdf" ? "pdf" : "image",
          original_filename: originalFilename || "unknown",
        },
      });
      if (error) throw error;
      return data;
    },
    onMutate: async (vars) => {
      const startedAt = Date.now();
      setPendingJobs((prev) => ({ ...prev, [vars.storagePath]: startedAt }));

      // Optimistic update: flip every row for this storage_path to "processing".
      const flip = <T extends AnalysisStatusLike>(entry: T): T =>
        entry.storage_path === vars.storagePath
          ? { ...entry, analysis_status: "processing", error_message: null, updated_at: new Date(startedAt).toISOString() }
          : entry;

      queryClient.setQueriesData<MediaAnalysisEntry[]>({ queryKey: ["media-analysis", vars.noteId] }, (old) =>
        old ? old.map(flip) : old,
      );
      queryClient.setQueriesData<AnalysisStatusLike[]>(
        { queryKey: ["media-library"] },
        (old) => (old ? old.map(flip) : old),
      );
    },
    onSettled: (_data, err, vars) => {
      if (err) {
        setPendingJobs((prev) => {
          const next = { ...prev };
          delete next[vars.storagePath];
          return next;
        });
      }
      queryClient.invalidateQueries({ queryKey: ["media-analysis", vars.noteId] });
      queryClient.invalidateQueries({ queryKey: ["media-library"] });
    },
  });

  return {
    ...mutation,
    pendingPaths: new Set(Object.keys(pendingJobs)),
    isPathPending,
    hasActivePendingJobs,
  };
}
