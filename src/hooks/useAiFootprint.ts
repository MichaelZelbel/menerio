import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { showToast } from "@/lib/toast";
import { invalidateFactViews, retractFact } from "@/hooks/useFacts";

/**
 * Drop every cached view of the data a footprint removal deletes. These are
 * the prefixes the pages actually query under (hyphenated).
 */
function invalidateDerivedData(qc: QueryClient) {
  for (const key of ["wiki-pages", "wiki-page", "note-connections"]) {
    qc.invalidateQueries({ queryKey: [key] });
  }
  invalidateFactViews(qc);
}

/** A fact (claim) a note produced. */
export interface FootprintFact {
  /** The claim id. */
  id: string;
  label: string;
  value: string;
  subjectType: "self" | "contact" | "entity";
  subjectId: string | null;
  attribute: string;
  categorySlug: string | null;
  contactId: string | null;
  /** Who the fact is about: a person's or a World entry's name, or "You". */
  contactName: string | null;
}

export interface AiFootprint {
  wikiPages: Array<{ id: string; title: string; slug: string; sourceLinkId: string }>;
  /** Facts whose source is this note (claims with source_type 'note'). */
  profileEntries: FootprintFact[];
  connections: Array<{
    id: string;
    otherNoteId: string;
    otherNoteTitle: string | null;
    direction: "source" | "target";
    connectionType: string | null;
  }>;
}

/**
 * The facts a note's AI processing produced. A fact the user typed, or corrected
 * since (rank 'preferred'), is theirs even when it cites the note, so removing
 * the note's footprint must not delete it.
 */
export function machineFootprintRows<T extends { source_type?: string | null; origin?: string | null; rank?: string | null }>(rows: T[]): T[] {
  return rows.filter((r) => r.source_type === "note" && r.rank !== "preferred" && r.origin !== "user_manual");
}

export async function fetchAiFootprint(noteId: string): Promise<AiFootprint> {
  const id = noteId;
  const [wikiRes, factRes, connSrcRes, connTgtRes] = await Promise.all([
    (supabase as any)
      .from("wiki_page_sources")
      .select("id, wiki_page_id, wiki_pages:wiki_page_id(id, title, slug)")
      .eq("note_id", id),
    (supabase as any)
      .from("profile_facts")
      .select("claim_id, subject_type, subject_id, attribute, value, label, category_slug, source_type, origin, rank")
      .eq("source_id", id),
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
  const failed = wikiRes.error || factRes.error || connSrcRes.error || connTgtRes.error;
  if (failed) throw failed;

  const wikiPages = (wikiRes.data ?? [])
    .filter((r: any) => r.wiki_pages)
    .map((r: any) => ({
      id: r.wiki_pages.id,
      title: r.wiki_pages.title,
      slug: r.wiki_pages.slug,
      sourceLinkId: r.id,
    }));

  const factRows = machineFootprintRows((factRes.data ?? []) as any[]);
  const names = await subjectNames(factRows);
  const profileEntries: FootprintFact[] = factRows.map((r) => ({
    id: r.claim_id,
    label: r.label,
    value: r.value,
    subjectType: r.subject_type,
    subjectId: r.subject_id,
    attribute: r.attribute,
    categorySlug: r.category_slug ?? null,
    contactId: r.subject_type === "contact" ? r.subject_id : null,
    contactName: r.subject_type === "self" ? "You" : names.get(r.subject_id) ?? null,
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

/** Names of the people and World entries the facts are about. A failed lookup only loses the name. */
async function subjectNames(rows: Array<{ subject_type: string; subject_id: string | null }>): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const ids = (type: string) => [...new Set(rows.filter((r) => r.subject_type === type && r.subject_id).map((r) => r.subject_id!))];
  const contactIds = ids("contact");
  const entityIds = ids("entity");
  const [contacts, entities] = await Promise.all([
    contactIds.length ? (supabase as any).from("contacts").select("id, name").in("id", contactIds) : { data: [] },
    entityIds.length ? (supabase as any).from("entities").select("id, name").in("id", entityIds) : { data: [] },
  ]);
  for (const r of [...(contacts?.data ?? []), ...(entities?.data ?? [])]) names.set(r.id, r.name);
  return names;
}

/** "Remove" a fact a note produced: it was wrong, so delete it and do not suggest it again. */
async function removeFootprintFact(fact: FootprintFact) {
  await retractFact({
    claim_id: fact.id,
    subject_type: fact.subjectType,
    subject_id: fact.subjectId,
    attribute: fact.attribute,
    category_slug: fact.categorySlug,
    value: fact.value,
  });
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
      if (kind === "profile") {
        const cached = qc.getQueryData<AiFootprint>(["ai_footprint", noteId]);
        const fact =
          cached?.profileEntries.find((p) => p.id === id) ??
          (noteId ? (await fetchAiFootprint(noteId)).profileEntries.find((p) => p.id === id) : undefined);
        if (!fact) throw new Error("This fact no longer exists");
        await removeFootprintFact(fact);
        return;
      }
      const table = kind === "wiki" ? "wiki_page_sources" : "note_connections";
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
      // One at a time: each is a delete plus its "do not suggest again" row.
      for (const fact of footprint.profileEntries) await removeFootprintFact(fact);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ai_footprint", noteId] });
      invalidateDerivedData(qc);
      showToast.success("All derived data removed");
    },
    onError: (e: any) => showToast.error(e.message ?? "Failed to remove"),
  });
}
