import { useQuery, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface GraphNode {
  id: string;
  title: string;
  type: string;
  topics: string[];
  tags: string[];
  created_at: string;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: string;
  strength: number;
  metadata: Record<string, unknown>;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface NoteConnection {
  id: string;
  source_note_id: string;
  target_note_id: string;
  connection_type: string;
  strength: number;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

/** Fetch the full knowledge graph for the current user */
export function useGraphData(options?: {
  limit?: number;
  min_strength?: number;
  connection_types?: string[];
  note_type?: string;
  topic?: string;
  person?: string;
}) {
  const { user } = useAuth();

  return useQuery<GraphData>({
    queryKey: ["graph-data", user?.id, options],
    enabled: !!user,
    queryFn: async () => {
      const res = await supabase.functions.invoke("get-graph-data", {
        body: options || {},
      });
      if (res.error) throw res.error;
      return res.data as GraphData;
    },
    staleTime: 60_000,
  });
}

/** Fetch neighborhood graph around a specific note */
export function useNoteNeighborhood(noteId: string | null, hops = 2) {
  const { user } = useAuth();

  return useQuery<GraphData>({
    queryKey: ["note-neighborhood", noteId, hops, user?.id],
    enabled: !!user && !!noteId,
    queryFn: async () => {
      const res = await supabase.functions.invoke("get-graph-data", {
        body: { note_id: noteId, hops },
      });
      if (res.error) throw res.error;
      return res.data as GraphData;
    },
    staleTime: 60_000,
  });
}

/** Fetch connections for a specific note from the database directly */
export function useNoteConnections(noteId: string | null) {
  const { user } = useAuth();

  return useQuery<NoteConnection[]>({
    queryKey: ["note-connections", noteId, user?.id],
    enabled: !!user && !!noteId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("note_connections" as any)
        .select("*")
        .eq("user_id", user!.id)
        .or(`source_note_id.eq.${noteId},target_note_id.eq.${noteId}`)
        .order("strength", { ascending: false });
      if (error) throw error;
      return (data as unknown as NoteConnection[]) || [];
    },
  });
}

/** Manually trigger connection computation for a note */
export function useComputeConnections() {
  return useMutation({
    mutationFn: async (noteId: string) => {
      const res = await supabase.functions.invoke("compute-connections", {
        body: { note_id: noteId },
      });
      if (res.error) throw res.error;
      return res.data;
    },
  });
}
