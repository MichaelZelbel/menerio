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
        return 5000;
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

function hasFreshFinalResult(entries: AnalysisStatusLike[] | undefined, path: string, startedAt: number) {
  if (!entries) return false;
  return entries.some((entry) => {
    if (entry.storage_path !== path) return false;
    if (entry.analysis_status !== "complete" && entry.analysis_status !== "failed") return false;
    const timestamp = Date.parse(entry.updated_at || entry.created_at || "");
    return Number.isFinite(timestamp) && timestamp >= startedAt - 1000;
  });
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
    const hasFinal = [...libraryCaches, ...noteCaches].some(([, entries]) =>
      hasFreshFinalResult(entries, path, startedAt),
    );
    return !hasFinal;
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

      // Optimistic update: flip status to "processing" for matching items in cached queries
      const flip = (entry: MediaAnalysisEntry | AnalysisStatusLike) =>
        entry.storage_path === vars.storagePath
          ? { ...entry, analysis_status: "processing", error_message: null, updated_at: new Date(startedAt).toISOString() }
          : entry;

      queryClient.setQueriesData<MediaAnalysisEntry[]>({ queryKey: ["media-analysis", vars.noteId] }, (old) =>
        old ? old.map((e) => flip(e) as MediaAnalysisEntry) : old,
      );
      queryClient.setQueriesData<Array<{ storage_path: string; analysis_status: string }>>(
        { queryKey: ["media-library"] },
        (old) => (old ? (old.map(flip) as typeof old) : old),
      );
    },
    onSettled: (_data, _err, vars) => {
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
