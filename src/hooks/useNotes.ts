import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { showToast } from "@/lib/toast";
import { triggerCreditsRefresh } from "@/lib/credits-events";

export interface RelatedItem {
  type: string;
  name: string;
  date?: string;
  source_app?: string;
  source_id?: string;
  source_url?: string;
}

export interface Note {
  id: string;
  user_id: string;
  title: string;
  content: string;
  metadata: Record<string, unknown> | null;
  tags: string[];
  is_favorite: boolean;
  is_pinned: boolean;
  is_trashed: boolean;
  trashed_at: string | null;
  entity_type: string | null;
  source_app: string | null;
  source_id: string | null;
  source_url: string | null;
  is_external: boolean;
  sync_status: string;
  structured_fields: Record<string, unknown>;
  related: RelatedItem[];
  created_at: string;
  updated_at: string;
}

export interface SemanticSearchResult extends Note {
  similarity: number | null;
}

type NoteInsert = {
  title?: string;
  content?: string;
  tags?: string[];
};

type NoteUpdate = {
  title?: string;
  content?: string;
  tags?: string[];
  is_favorite?: boolean;
  is_pinned?: boolean;
  is_trashed?: boolean;
  trashed_at?: string | null;
};

export function useNotes(filter: "all" | "favorites" | "trash" = "all") {
  const { user } = useAuth();

  return useQuery<Note[]>({
    queryKey: ["notes", filter, user?.id],
    enabled: !!user,
    queryFn: async () => {
      let query = supabase
        .from("notes" as any)
        .select("id, user_id, title, content, metadata, tags, is_favorite, is_pinned, is_trashed, trashed_at, entity_type, source_app, source_id, source_url, is_external, sync_status, structured_fields, related, created_at, updated_at")
        .eq("user_id", user!.id)
        .order("is_pinned", { ascending: false })
        .order("updated_at", { ascending: false });

      if (filter === "trash") {
        query = query.eq("is_trashed", true);
      } else if (filter === "favorites") {
        query = query.eq("is_trashed", false).eq("is_favorite", true);
      } else {
        query = query.eq("is_trashed", false);
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data as unknown as Note[]) || [];
    },
  });
}

export function useCreateNote() {
  const qc = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (input: NoteInsert = {}) => {
      const { data, error } = await supabase
        .from("notes" as any)
        .insert({ ...input, user_id: user!.id })
        .select()
        .single();
      if (error) throw error;
      return data as unknown as Note;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notes"] });
    },
    onError: () => {
      showToast.error("Failed to create note");
    },
  });
}

export function useUpdateNote() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...updates }: NoteUpdate & { id: string }) => {
      const { data, error } = await supabase
        .from("notes" as any)
        .update(updates)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data as unknown as Note;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notes"] });
    },
  });
}

export function useDeleteNote() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("notes" as any)
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notes"] });
      showToast.success("Note permanently deleted");
    },
    onError: () => {
      showToast.error("Failed to delete note");
    },
  });
}

export function useProcessNote() {
  return useMutation({
    mutationFn: async (noteId: string) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      const res = await supabase.functions.invoke("process-note", {
        body: { note_id: noteId },
      });
      if (res.error) throw res.error;
      // Trigger credits refresh after AI processing
      triggerCreditsRefresh();
      return res.data;
    },
  });
}

/** ILIKE-based instant search (no AI cost) */
export function useIlikeSearch() {
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (query: string): Promise<SemanticSearchResult[]> => {
      const q = query.toLowerCase();
      const { data, error } = await supabase
        .from("notes" as any)
        .select("id, user_id, title, content, metadata, tags, is_favorite, is_pinned, is_trashed, trashed_at, entity_type, source_app, source_id, source_url, is_external, sync_status, structured_fields, related, created_at, updated_at")
        .eq("user_id", user!.id)
        .eq("is_trashed", false)
        .or(`title.ilike.%${q}%,content.ilike.%${q}%`)
        .order("updated_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return ((data as unknown as Note[]) || []).map((n) => ({ ...n, similarity: null }));
    },
  });
}

/** Semantic vector search via edge function */
export function useSemanticSearch() {
  return useMutation({
    mutationFn: async ({
      query,
      threshold = 0.5,
      limit = 20,
    }: {
      query: string;
      threshold?: number;
      limit?: number;
    }): Promise<{ results: SemanticSearchResult[]; mode: string }> => {
      const res = await supabase.functions.invoke("search-notes-semantic", {
        body: { query, threshold, limit },
      });
      if (res.error) throw res.error;
      // Trigger credits refresh after semantic search
      triggerCreditsRefresh();
      return res.data as { results: SemanticSearchResult[]; mode: string };
    },
  });
}

/** Combined search: ILIKE fires instantly, semantic replaces when ready */
export function useSearchNotes() {
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (query: string) => {
      const q = query.toLowerCase();
      const { data, error } = await supabase
        .from("notes" as any)
        .select("id, user_id, title, content, metadata, tags, is_favorite, is_pinned, is_trashed, trashed_at, entity_type, source_app, source_id, source_url, is_external, sync_status, structured_fields, related, created_at, updated_at")
        .eq("user_id", user!.id)
        .eq("is_trashed", false)
        .or(`title.ilike.%${q}%,content.ilike.%${q}%`)
        .order("updated_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data as unknown as Note[]) || [];
    },
  });
}
