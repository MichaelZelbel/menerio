import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { showToast } from "@/lib/toast";
import { moderateContent, ModerationResult } from "@/lib/moderateContent";

interface SharedNote {
  id: string;
  note_id: string;
  share_token: string;
  is_active: boolean;
}

export interface ShareNoteInput {
  noteId: string;
  title: string;
  content: string;
}

export interface ShareNoteResult {
  url?: string;
  blocked?: boolean;
  moderation?: ModerationResult;
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

  return useMutation<ShareNoteResult, Error, ShareNoteInput>({
    mutationFn: async ({ noteId, title, content }) => {
      // Run moderation check first
      const modResult = await moderateContent(
        { title, content },
        "share_note",
        "note",
        noteId
      );

      if (!modResult.approved) {
        return { blocked: true, moderation: modResult };
      }

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
      return { url: getShareUrl(shareToken) };
    },
    // The clipboard write lives here, NOT in mutationFn: if it lived alongside
    // the DB upsert, a clipboard rejection (Safari's same-gesture rule, lost
    // focus, denied permission) would reject the whole mutation and show
    // "Failed to share note" — even though the note is already publicly shared.
    onSuccess: async (result, { noteId }) => {
      if (result.blocked) return;
      qc.invalidateQueries({ queryKey: ["shared-note", noteId] });
      try {
        if (result.url) await navigator.clipboard.writeText(result.url);
        showToast.success("Public link copied to clipboard");
      } catch {
        showToast.success("Public link created — copy it from the share menu");
      }
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
