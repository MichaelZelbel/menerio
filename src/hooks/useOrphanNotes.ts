import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { fetchAllPages } from "@/lib/postgrest";

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
export function useOrphanNotes({ withContent = true }: { withContent?: boolean } = {}) {
  const { user } = useAuth();
  // The Dashboard card shows a count and three titles, but this used to load
  // every visible note's full body to get them (about 1,700 on a large
  // account). Only the full list, which shows a preview line, needs content.
  const columns = withContent
    ? "id, title, content, metadata, updated_at, ai_visibility, is_trashed"
    : "id, title, metadata, updated_at, ai_visibility, is_trashed";

  return useQuery({
    queryKey: ["orphan-notes", user?.id, withContent ? "full" : "titles"],
    enabled: !!user,
    queryFn: async () => {
      // 1. Fetch all AI-visible, non-trashed notes for the user.
      //    Paged too: unpaged, a vault past 1,000 notes never showed the rest.
      const notes = await fetchAllPages<OrphanNote>((from, to) =>
        (supabase as any)
          .from("notes")
          .select(columns)
          .eq("user_id", user!.id)
          .eq("is_trashed", false)
          .eq("ai_visibility", "visible")
          .order("updated_at", { ascending: false })
          .order("id", { ascending: true })
          .range(from, to),
      );

      // 2. Page through all note_connections for the user. Ordered by id so
      //    the pages neither repeat nor skip rows.
      const connected = new Set<string>();
      const connections = await fetchAllPages<{ source_note_id: string; target_note_id: string }>(
        (from, to) =>
          (supabase as any)
            .from("note_connections")
            .select("source_note_id, target_note_id")
            .eq("user_id", user!.id)
            .order("id", { ascending: true })
            .range(from, to),
      );
      for (const r of connections) {
        if (r.source_note_id) connected.add(r.source_note_id);
        if (r.target_note_id) connected.add(r.target_note_id);
      }

      const orphans: OrphanNote[] = notes.filter(
        (n) => !connected.has(n.id),
      );
      return { orphans, total: orphans.length };
    },
  });
}
