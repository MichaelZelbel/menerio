import { useState } from "react";
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

const MAX_CLIENT_PENDING_MS = 10 * 60 * 1000;

/**
 * A retry job is considered finished only when:
 *  1) there is at least one row for this path whose updated_at >= startedAt (fresh),
 *  2) AND none of the rows for this path are still in 'processing' or 'pending'.
 *
 * This handles multi-page PDFs correctly: completing page 1 must not end the job
 * while page 2 is still processing.
 */
function isJobFinished(entries: AnalysisStatusLike[] | undefined, path: string, startedAt: number): boolean {
  if (!entries) return false;
  const rows = entries.filter((e) => e.storage_path === path);
  if (rows.length === 0) return false;

  const hasFresh = rows.some((e) => {
    const ts = Date.parse(e.updated_at || e.created_at || "");
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

  const isPathPending = (path: string) => {
    const startedAt = pendingJobs[path];
    if (!startedAt) return false;
    if (Date.now() - startedAt > MAX_CLIENT_PENDING_MS) return false;

    const libraryCaches = queryClient.getQueriesData<AnalysisStatusLike[]>({ queryKey: ["media-library"] });
    const noteCaches = queryClient.getQueriesData<AnalysisStatusLike[]>({ queryKey: ["media-analysis"] });
    const finished = [...libraryCaches, ...noteCaches].some(([, entries]) =>
      isJobFinished(entries, path, startedAt),
    );
    return !finished;
  };

  const hasActivePendingJobs = () => Object.keys(pendingJobs).some(isPathPending);

  const mutation = useMutation({
    mutationFn: async ({ noteId, storagePath, mediaType, originalFilename }: ReanalyzeVars) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      const functionName = mediaType === "pdf" ? "analyze-pdf" : "analyze-media";
      const { data, error } = await supabase.functions.invoke(functionName, {
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
    pendingPaths: new Set(Object.keys(pendingJobs).filter(isPathPending)),
    isPathPending,
    hasActivePendingJobs,
  };
}
