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

export function useReanalyzeMedia() {
  const queryClient = useQueryClient();
  const [pendingPaths, setPendingPaths] = useState<Set<string>>(new Set());

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
      setPendingPaths((prev) => {
        const next = new Set(prev);
        next.add(vars.storagePath);
        return next;
      });

      // Optimistic update: flip status to "processing" for matching items in cached queries
      const flip = (entry: MediaAnalysisEntry | { storage_path: string; analysis_status: string }) =>
        entry.storage_path === vars.storagePath
          ? { ...entry, analysis_status: "processing", error_message: null }
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
      setPendingPaths((prev) => {
        const next = new Set(prev);
        next.delete(vars.storagePath);
        return next;
      });
      queryClient.invalidateQueries({ queryKey: ["media-analysis", vars.noteId] });
      queryClient.invalidateQueries({ queryKey: ["media-library"] });
    },
  });

  return {
    ...mutation,
    pendingPaths,
    isPathPending: (path: string) => pendingPaths.has(path),
  };
}
