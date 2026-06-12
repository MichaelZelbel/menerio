import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface OrphanNote {
  id: string;
  title: string | null;
  content: string | null;
  metadata: Record<string, unknown> | null;
  updated_at: string;
}

/**
 * Returns the user's notes that have NO entry in `note_connections`
 * (neither as source nor as target) AND are visible to AI.
 *
 * Notes hidden from AI are intentionally excluded — for those notes the user
 * has explicitly opted out of cross-linking, so surfacing them as "orphans
 * to connect" is noise.
 *
 * Connections are paginated through fully (not capped at 500 like the graph),
 * so the count matches reality.
 */
export function useOrphanNotes() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["orphan-notes", user?.id],
    enabled: !!user,
    queryFn: async () => {
      // 1. Fetch all AI-visible, non-trashed notes for the user.
      const { data: notes, error: notesError } = await (supabase as any)
        .from("notes")
        .select("id, title, content, metadata, updated_at, ai_visibility, is_trashed")
        .eq("user_id", user!.id)
        .eq("is_trashed", false)
        .eq("ai_visibility", "visible")
        .order("updated_at", { ascending: false });
      if (notesError) throw notesError;

      // 2. Page through all note_connections for the user.
      const connected = new Set<string>();
      const PAGE = 1000;
      let from = 0;
      // Hard safety ceiling to avoid runaway loops.
      for (let i = 0; i < 50; i++) {
        const { data: rows, error } = await (supabase as any)
          .from("note_connections")
          .select("source_note_id, target_note_id")
          .eq("user_id", user!.id)
          .range(from, from + PAGE - 1);
        if (error) throw error;
        if (!rows || rows.length === 0) break;
        for (const r of rows as Array<{ source_note_id: string; target_note_id: string }>) {
          if (r.source_note_id) connected.add(r.source_note_id);
          if (r.target_note_id) connected.add(r.target_note_id);
        }
        if (rows.length < PAGE) break;
        from += PAGE;
      }

      const orphans: OrphanNote[] = ((notes ?? []) as OrphanNote[]).filter(
        (n) => !connected.has(n.id),
      );
      return { orphans, total: orphans.length };
    },
  });
}
