import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { showToast } from "@/lib/toast";

interface SharedNote {
  id: string;
  note_id: string;
  share_token: string;
  is_active: boolean;
}

export function useSharedNote(noteId: string) {
  const { user } = useAuth();

  return useQuery<SharedNote | null>({
    queryKey: ["shared-note", noteId],
    enabled: !!user && !!noteId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("shared_notes" as any)
        .select("id, note_id, share_token, is_active")
        .eq("note_id", noteId)
        .eq("user_id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return (data as unknown as SharedNote) || null;
    },
  });
}

function generateToken(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 12);
}

function getShareUrl(token: string): string {
  return `${window.location.origin}/shared/${token}`;
}

export function useShareNote() {
  const qc = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (noteId: string) => {
      const token = generateToken();
      const { data, error } = await supabase
        .from("shared_notes" as any)
        .upsert(
          { note_id: noteId, user_id: user!.id, share_token: token, is_active: true },
          { onConflict: "note_id" }
        )
        .select("share_token")
        .single();
      if (error) throw error;
      const shareToken = (data as any).share_token;
      const url = getShareUrl(shareToken);
      await navigator.clipboard.writeText(url);
      return url;
    },
    onSuccess: (_, noteId) => {
      qc.invalidateQueries({ queryKey: ["shared-note", noteId] });
      showToast.success("Public link copied to clipboard");
    },
    onError: () => showToast.error("Failed to share note"),
  });
}

export function useUnshareNote() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (noteId: string) => {
      const { error } = await supabase
        .from("shared_notes" as any)
        .update({ is_active: false })
        .eq("note_id", noteId);
      if (error) throw error;
    },
    onSuccess: (_, noteId) => {
      qc.invalidateQueries({ queryKey: ["shared-note", noteId] });
      showToast.success("Sharing disabled");
    },
    onError: () => showToast.error("Failed to disable sharing"),
  });
}

export function useCopyShareLink() {
  return useMutation({
    mutationFn: async (token: string) => {
      const url = getShareUrl(token);
      await navigator.clipboard.writeText(url);
      return url;
    },
    onSuccess: () => showToast.copied(),
  });
}
