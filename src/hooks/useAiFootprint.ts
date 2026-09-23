import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { showToast } from "@/lib/toast";

/**
 * Drop every cached view of the data a footprint removal deletes. These are
 * the prefixes the pages actually query under (hyphenated); the underscored
 * table names that used to be invalidated here matched nothing, so deleted
 * profile entries kept rendering for the cache's lifetime and survived reloads
 * through the persister.
 */
function invalidateDerivedData(qc: QueryClient) {
  for (const key of ["wiki-pages", "wiki-page", "profile-entries", "contact-profile-entries", "note-connections"]) {
    qc.invalidateQueries({ queryKey: [key] });
  }
}

export interface AiFootprint {
  wikiPages: Array<{ id: string; title: string; slug: string; sourceLinkId: string }>;
  profileEntries: Array<{
    id: string;
    label: string;
    value: string;
    contactId: string | null;
    contactName: string | null;
  }>;
  connections: Array<{
    id: string;
    otherNoteId: string;
    otherNoteTitle: string | null;
    direction: "source" | "target";
    connectionType: string | null;
  }>;
}

export async function fetchAiFootprint(noteId: string): Promise<AiFootprint> {
  const id = noteId;
  const [wikiRes, profileRes, connSrcRes, connTgtRes] = await Promise.all([
    (supabase as any)
      .from("wiki_page_sources")
      .select("id, wiki_page_id, wiki_pages:wiki_page_id(id, title, slug)")
      .eq("note_id", id),
    (supabase as any)
      .from("profile_entries")
      .select("id, label, value, contact_id, contacts:contact_id(id, name)")
      .eq("linked_note_id", id),
    (supabase as any)
      .from("note_connections")
      .select("id, target_note_id, connection_type, target:target_note_id(id, title)")
      .eq("source_note_id", id),
    (supabase as any)
      .from("note_connections")
      .select("id, source_note_id, connection_type, source:source_note_id(id, title)")
      .eq("target_note_id", id),
  ]);
  // Throw rather than report an empty footprint: callers (the hide-from-AI
  // flow, the footprint dialog) treat "nothing derived" as "nothing to clean
  // up", so a failed read silently skipped the cleanup offer.
  const failed = wikiRes.error || profileRes.error || connSrcRes.error || connTgtRes.error;
  if (failed) throw failed;

  const wikiPages = (wikiRes.data ?? [])
    .filter((r: any) => r.wiki_pages)
    .map((r: any) => ({
      id: r.wiki_pages.id,
      title: r.wiki_pages.title,
      slug: r.wiki_pages.slug,
      sourceLinkId: r.id,
    }));

  const profileEntries = (profileRes.data ?? []).map((r: any) => ({
    id: r.id,
    label: r.label,
    value: r.value,
    contactId: r.contact_id,
    contactName: r.contacts?.name ?? null,
  }));

  const connections = [
    ...(connSrcRes.data ?? []).map((r: any) => ({
      id: r.id,
      otherNoteId: r.target_note_id,
      otherNoteTitle: r.target?.title ?? null,
      direction: "source" as const,
      connectionType: r.connection_type,
    })),
    ...(connTgtRes.data ?? []).map((r: any) => ({
      id: r.id,
      otherNoteId: r.source_note_id,
      otherNoteTitle: r.source?.title ?? null,
      direction: "target" as const,
      connectionType: r.connection_type,
    })),
  ];

  return { wikiPages, profileEntries, connections };
}

export function useAiFootprint(noteId: string | null, enabled = true) {
  return useQuery({
    queryKey: ["ai_footprint", noteId],
    enabled: !!noteId && enabled,
    queryFn: () => fetchAiFootprint(noteId!),
  });
}

export function useRemoveFootprintItem(noteId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      kind,
      id,
    }: {
      kind: "wiki" | "profile" | "connection";
      id: string;
    }) => {
      const table =
        kind === "wiki"
          ? "wiki_page_sources"
          : kind === "profile"
            ? "profile_entries"
            : "note_connections";
      const { error } = await (supabase as any).from(table).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ai_footprint", noteId] });
      invalidateDerivedData(qc);
      showToast.success("Removed");
    },
    onError: (e: any) => showToast.error(e.message ?? "Failed to remove"),
  });
}

export function useRemoveAllFootprint(noteId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (footprint: AiFootprint) => {
      const calls: Promise<any>[] = [];
      if (footprint.wikiPages.length) {
        calls.push(
          (supabase as any)
            .from("wiki_page_sources")
            .delete()
            .in("id", footprint.wikiPages.map((w) => w.sourceLinkId)),
        );
      }
      if (footprint.profileEntries.length) {
        calls.push(
          (supabase as any)
            .from("profile_entries")
            .delete()
            .in("id", footprint.profileEntries.map((p) => p.id)),
        );
      }
      if (footprint.connections.length) {
        calls.push(
          (supabase as any)
            .from("note_connections")
            .delete()
            .in("id", footprint.connections.map((c) => c.id)),
        );
      }
      const results = await Promise.all(calls);
      const err = results.find((r) => r.error)?.error;
      if (err) throw err;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ai_footprint", noteId] });
      invalidateDerivedData(qc);
      showToast.success("All derived data removed");
    },
    onError: (e: any) => showToast.error(e.message ?? "Failed to remove"),
  });
}
