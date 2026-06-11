import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { showToast } from "@/lib/toast";

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
      qc.invalidateQueries({ queryKey: ["wiki_pages"] });
      qc.invalidateQueries({ queryKey: ["profile_entries"] });
      qc.invalidateQueries({ queryKey: ["note_connections"] });
      showToast.success("All derived data removed");
    },
    onError: (e: any) => showToast.error(e.message ?? "Failed to remove"),
  });
}
