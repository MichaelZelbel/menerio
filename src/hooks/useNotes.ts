import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useQuery as usePowerSyncQuery } from "@powersync/tanstack-react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { showToast } from "@/lib/toast";
import { triggerCreditsRefresh } from "@/lib/credits-events";
import { ilikeContains, escapeLike as escapeLikeFilter, pgOrValue } from "@/lib/postgrest";
import { extractSearchTerms, rankNotesByTerms } from "@/lib/search-terms";

import { OFFLINE_CORE } from "@/lib/flags";
import { isLocalFirstActive, useLocalFirstActive } from "@/sync/sync-health";
import { getDb } from "@/sync/db";
import { rowToNote, toSqliteValue, type NoteRow } from "@/sync/notes-mapping";
import { broadcastInvalidation } from "@/lib/query-sync";
import { nextDuplicateTitle } from "@/lib/duplicate-entity";


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
  folder_path: string;
  is_external: boolean;
  sync_status: string;
  structured_fields: Record<string, unknown>;
  related: RelatedItem[];
  ai_visibility?: "visible" | "hidden";
  processing_status?: string | null;
  processed_at?: string | null;
  processing_error?: string | null;

  created_at: string;
  updated_at: string;
}

export interface SemanticSearchResult extends Note {
  similarity: number | null;
  match_source?: "note" | "media" | "both";
  media_description?: string;
  media_storage_path?: string;
  media_type?: string;
  media_topics?: string[];
  media_page_number?: number;
  media_filename?: string;
}

type NoteInsert = {
  title?: string;
  content?: string;
  tags?: string[];
  folder_path?: string;
};

type NoteUpdate = {
  title?: string;
  content?: string;
  tags?: string[];
  folder_path?: string;
  metadata?: Record<string, unknown> | null;
  is_favorite?: boolean;
  is_pinned?: boolean;
  is_trashed?: boolean;
  trashed_at?: string | null;
};

const NOTE_COLUMNS =
  "id, user_id, title, content, metadata, tags, is_favorite, is_pinned, is_trashed, trashed_at, entity_type, source_app, source_id, source_url, folder_path, is_external, sync_status, structured_fields, related, ai_visibility, processing_status, processed_at, processing_error, created_at, updated_at";


// SQL filter fragments for the local (SQLite) notes list.
const LOCAL_FILTER_SQL: Record<"all" | "favorites" | "trash", string> = {
  all: "is_trashed = 0",
  favorites: "is_trashed = 0 AND is_favorite = 1",
  trash: "is_trashed = 1",
};

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

const wikiIngestTimers = new Map<string, ReturnType<typeof setTimeout>>();
const wikiIngestInFlight = new Set<string>();

function invokeWikiIngest(noteId: string, changeType: "INSERT" | "UPDATE", delayMs = 12_000) {
  const existingTimer = wikiIngestTimers.get(noteId);
  if (existingTimer) clearTimeout(existingTimer);

  const timer = setTimeout(() => {
    wikiIngestTimers.delete(noteId);
    if (wikiIngestInFlight.has(noteId)) return;
    wikiIngestInFlight.add(noteId);

    supabase.functions
      .invoke("wiki-ingest", {
        body: {
          note_id: noteId,
          change_type: changeType,
        },
      })
      .then(({ error }) => {
        if (error) console.warn("wiki-ingest invocation failed:", error);
      })
      .catch((err) => {
        console.warn("wiki-ingest invocation failed:", err);
      })
      .finally(() => {
        wikiIngestInFlight.delete(noteId);
      });
  }, delayMs);

  wikiIngestTimers.set(noteId, timer);
}

function useNotesRemote(
  filter: "all" | "favorites" | "trash",
  { enabled = true, keySuffix }: { enabled?: boolean; keySuffix?: string } = {},
) {
  const { user } = useAuth();

  return useQuery<Note[]>({
    // The fallback needs its own cache entry. Registering two different query
    // functions under one key makes whichever mounted last answer for both.
    // Everything still invalidates on the ["notes"] prefix.
    queryKey: keySuffix
      ? ["notes", filter, user?.id, keySuffix]
      : ["notes", filter, user?.id],
    enabled: !!user && enabled,
    // The list carries full note bodies, so it is an expensive query for large
    // vaults. Freshness of the *open* note is guaranteed by `useNote` below
    // (a cheap single-row query that always revalidates on mount); the list
    // itself only needs to be eventually consistent.
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    queryFn: async () => {

      let query = supabase
        .from("notes" as any)
        .select(NOTE_COLUMNS)
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

// Local-first variant: a live SQLite query that re-renders whenever the
// notes table changes (local edits or background sync).
function useNotesLocal(
  filter: "all" | "favorites" | "trash",
  { enabled = true }: { enabled?: boolean } = {},
) {
  const { user } = useAuth();

  return usePowerSyncQuery<Note>({
    queryKey: ["notes", filter, user?.id],
    enabled: !!user && enabled,
    query: `SELECT * FROM notes WHERE user_id = ? AND ${LOCAL_FILTER_SQL[filter]} ORDER BY is_pinned DESC, updated_at DESC`,
    parameters: [user?.id ?? ""],
    select: (rows) => (rows as unknown as NoteRow[]).map(rowToNote),
  });
}

/**
 * The local-first list, with the server as a fallback when sync is dead.
 *
 * Only ever called on OFFLINE_CORE sessions, so the PowerSync context that
 * useNotesLocal needs is mounted. Both hooks run on every render and only the
 * RESULT is chosen, because the choice changes at runtime and a conditional
 * hook call would reorder the hook list mid-session.
 */
function useNotesLocalWithFallback(filter: "all" | "favorites" | "trash") {
  const localFirst = useLocalFirstActive();
  const local = useNotesLocal(filter, { enabled: localFirst });
  const remote = useNotesRemote(filter, {
    enabled: !localFirst,
    keySuffix: "server-fallback",
  });
  return localFirst ? local : remote;
}

export function useNotes(filter: "all" | "favorites" | "trash" = "all") {
  // OFFLINE_CORE is constant for the lifetime of the page, so this branch is
  // stable and hook order never changes between renders. What is NOT constant
  // is whether sync works, and that is handled inside the local branch rather
  // than here, because useNotesLocal cannot even be called without the
  // PowerSync context that only OFFLINE_CORE sessions mount.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return OFFLINE_CORE ? useNotesLocalWithFallback(filter) : useNotesRemote(filter);
}

/**
 * Single-note query. This is the authoritative source for the open editor:
 * it is a one-row fetch, so it can always revalidate on mount (fresh windows,
 * pop-outs) without pulling the whole vault over the wire.
 */
export function useNote(id: string | null | undefined) {
  const { user } = useAuth();

  return useQuery<Note | null>({
    queryKey: ["note", id],
    // Also enabled on the local-first (desktop) path: the single row keeps the
    // open editor converged with the server even if the local replica lags.
    // Offline it simply fails and callers fall back to the local copy.
    enabled: !!id && !!user,
    refetchOnMount: "always",
    staleTime: 0,

    queryFn: async () => {
      const { data, error } = await supabase
        .from("notes" as any)
        .select(NOTE_COLUMNS)
        .eq("id", id!)
        .maybeSingle();
      if (error) throw error;
      return (data as unknown as Note) ?? null;
    },
  });
}

// Inserts a note into local SQLite with the same defaults the Postgres
// schema applies server-side; PowerSync uploads the full row on sync.
async function createNoteLocal(userId: string, input: NoteInsert): Promise<Note> {
  const db = getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.execute(
    `INSERT INTO notes (id, user_id, title, content, metadata, tags, is_favorite, is_pinned, is_trashed, trashed_at, entity_type, source_app, source_id, source_url, folder_path, is_external, sync_status, structured_fields, related, ai_visibility, created_at, updated_at)
     VALUES (?, ?, ?, ?, '{}', ?, 0, 0, 0, NULL, NULL, NULL, NULL, NULL, ?, 0, 'synced', '{}', '[]', 'visible', ?, ?)`,
    [
      id,
      userId,
      input.title ?? "",
      input.content ?? "",
      JSON.stringify(input.tags ?? []),
      input.folder_path ?? "",
      now,
      now,
    ],
  );
  const row = await db.get<NoteRow>("SELECT * FROM notes WHERE id = ?", [id]);
  return rowToNote(row);
}

export function useCreateNote() {
  const qc = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (input: NoteInsert = {}) => {
      if (isLocalFirstActive()) return createNoteLocal(user!.id, input);
      const { data, error } = await supabase
        .from("notes" as any)
        .insert({ ...input, user_id: user!.id })
        .select()
        .single();
      if (error) throw error;
      return data as unknown as Note;
    },
    onSuccess: (note) => {
      qc.invalidateQueries({ queryKey: ["notes"] });
      broadcastInvalidation([["notes"]]);
      if ((note.title || note.content || "").trim().length >= 20) {
        invokeWikiIngest(note.id, "INSERT");
      }
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
      if (isLocalFirstActive()) {
        const db = getDb();
        const sets: string[] = [];
        const params: unknown[] = [];
        for (const [key, value] of Object.entries(updates)) {
          const serialized = toSqliteValue(key, value);
          if (serialized === undefined) continue;
          sets.push(`${key} = ?`);
          params.push(serialized);
        }
        // Device-local ordering only; the connector strips updated_at on
        // upload so the server trigger stays authoritative.
        sets.push("updated_at = ?");
        params.push(new Date().toISOString());
        await db.execute(`UPDATE notes SET ${sets.join(", ")} WHERE id = ?`, [
          ...params,
          id,
        ]);
        const row = await db.get<NoteRow>("SELECT * FROM notes WHERE id = ?", [id]);
        return rowToNote(row);
      }
      const { data, error } = await supabase
        .from("notes" as any)
        .update(updates)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data as unknown as Note;
    },
    onSuccess: (note, variables) => {
      const queries = qc.getQueriesData<Note[]>({ queryKey: ["notes"] });
      for (const [key, current] of queries) {
        if (!current) continue;
        const filter = (key?.[1] as string) ?? "all";
        const exists = current.some((item) => item.id === note.id);
        const merged = exists
          ? current.map((item) => (item.id === note.id ? { ...item, ...note } : item))
          : [...current, note];
        const next = merged.filter((item) => {
          if (filter === "trash") return item.is_trashed === true;
          if (filter === "favorites") return item.is_trashed === false && item.is_favorite === true;
          return item.is_trashed === false; // "all"
        });
        qc.setQueryData<Note[]>(key, next);
      }
      // The open editor reads from ["note", id] — patch it directly.
      qc.setQueryData<Note | null>(["note", note.id], note);

      // A content-only autosave must NOT invalidate the (expensive) notes list:
      // for large vaults that meant refetching every note body on every
      // keystroke burst, and a late-resolving stale list response could
      // overwrite the just-saved content in the cache.
      const listVisibleFields = [
        "title",
        "tags",
        "folder_path",
        "is_favorite",
        "is_pinned",
        "is_trashed",
        "trashed_at",
        "metadata",
      ] as const;
      const listVisibleChanged = listVisibleFields.some(
        (field) => (variables as Record<string, unknown>)[field] !== undefined,
      );
      if (listVisibleChanged) {
        qc.invalidateQueries({ queryKey: ["notes"], refetchType: "inactive" });
        broadcastInvalidation([["notes"], ["note", note.id]]);
      } else {
        broadcastInvalidation([["note", note.id]]);
      }

      if (variables.title !== undefined || variables.content !== undefined) {
        invokeWikiIngest(note.id, "UPDATE");
      }
    },
  });
}

export function useDeleteNote() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      if (isLocalFirstActive()) {
        await getDb().execute("DELETE FROM notes WHERE id = ?", [id]);
        return;
      }
      const { error } = await supabase
        .from("notes" as any)
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notes"] });
      broadcastInvalidation([["notes"]]);

      showToast.batched.success("note:delete-permanent", (n) =>
        n === 1 ? "Note permanently deleted" : `${n} notes permanently deleted`,
      );
    },
    onError: () => {
      showToast.error("Failed to delete note");
    },
  });
}

export { nextDuplicateTitle };

async function duplicateNoteLocal(userId: string, sourceId: string): Promise<Note> {
  const db = getDb();
  const srcRow = await db.get<NoteRow>("SELECT * FROM notes WHERE id = ?", [sourceId]);
  const src = rowToNote(srcRow);

  const siblings = await db.getAll<{ title: string | null }>(
    "SELECT title FROM notes WHERE user_id = ? AND folder_path = ? AND is_trashed = 0",
    [userId, src.folder_path || ""],
  );
  const existing = new Set(siblings.map((r) => (r.title || "").trim()));
  const candidate = nextDuplicateTitle(src.title, existing);

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.execute(
    `INSERT INTO notes (id, user_id, title, content, metadata, tags, is_favorite, is_pinned, is_trashed, trashed_at, entity_type, source_app, source_id, source_url, folder_path, is_external, sync_status, structured_fields, related, ai_visibility, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0, NULL, ?, NULL, NULL, NULL, ?, 0, 'synced', ?, '[]', 'visible', ?, ?)`,
    [
      id,
      userId,
      candidate,
      src.content,
      JSON.stringify({ ...(src.metadata || {}), duplicated_from: src.id }),
      JSON.stringify(src.tags || []),
      src.entity_type,
      src.folder_path || "",
      JSON.stringify(src.structured_fields || {}),
      now,
      now,
    ],
  );
  const row = await db.get<NoteRow>("SELECT * FROM notes WHERE id = ?", [id]);
  return rowToNote(row);
}

export function useDuplicateNote() {
  const qc = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (sourceId: string): Promise<Note> => {
      if (isLocalFirstActive()) return duplicateNoteLocal(user!.id, sourceId);

      // Fetch source
      const { data: source, error: srcErr } = await supabase
        .from("notes" as any)
        .select("*")
        .eq("id", sourceId)
        .single();
      if (srcErr) throw srcErr;
      const src = source as unknown as Note;

      // Fetch sibling titles in the same folder
      const { data: siblings, error: sibErr } = await supabase
        .from("notes" as any)
        .select("title")
        .eq("user_id", user!.id)
        .eq("folder_path", src.folder_path || "")
        .eq("is_trashed", false);
      if (sibErr) throw sibErr;
      const existing = new Set(
        ((siblings as unknown as { title: string }[]) || []).map((r) => (r.title || "").trim()),
      );

      const candidate = nextDuplicateTitle(src.title, existing);

      const insertRow = {
        user_id: user!.id,
        title: candidate,
        content: src.content,
        tags: src.tags || [],
        folder_path: src.folder_path || "",
        entity_type: src.entity_type,
        structured_fields: src.structured_fields || {},
        metadata: { ...(src.metadata || {}), duplicated_from: src.id },
        is_pinned: false,
        is_favorite: false,
        is_trashed: false,
      };

      const { data, error } = await supabase
        .from("notes" as any)
        .insert(insertRow)
        .select()
        .single();
      if (error) throw error;
      return data as unknown as Note;
    },
    onSuccess: (note) => {
      qc.invalidateQueries({ queryKey: ["notes"] });
      broadcastInvalidation([["notes"]]);

      showToast.success("Duplicated note");
      if ((note.title || note.content || "").trim().length >= 20) {
        invokeWikiIngest(note.id, "INSERT");
      }
    },
    onError: () => {
      showToast.error("Failed to duplicate note");
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

// Case-insensitive substring search against the local SQLite replica.
// Instant and fully offline; callers pass an already-lowercased query.
// Title matches are fetched separately so a recency cut-off can never hide the
// note whose *title* is what the user typed.
async function searchNotesLocal(userId: string, q: string, terms: string[]): Promise<Note[]> {
  const pattern = `%${escapeLike(q)}%`;
  const db = getDb();
  const titleRows = await db.getAll<NoteRow>(
    `SELECT * FROM notes
     WHERE user_id = ? AND is_trashed = 0
       AND (lower(title) LIKE ? ESCAPE '\\'${terms.map(() => ` OR lower(title) LIKE ? ESCAPE '\\'`).join("")})
     ORDER BY length(title) ASC
     LIMIT 30`,
    [userId, pattern, ...terms.map((t) => `%${escapeLike(t)}%`)],
  );
  const rows = await db.getAll<NoteRow>(
    `SELECT * FROM notes
     WHERE user_id = ? AND is_trashed = 0
       AND (lower(title) LIKE ? ESCAPE '\\' OR lower(content) LIKE ? ESCAPE '\\')
     ORDER BY updated_at DESC
     LIMIT 50`,
    [userId, pattern, pattern],
  );
  const seen = new Set<string>();
  const merged: NoteRow[] = [];
  for (const r of [...titleRows, ...rows]) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    merged.push(r);
  }
  return merged.map(rowToNote);
}

/**
 * Candidate rows for a keyword search. Runs two passes so that title matches are
 * always part of the candidate set: a title-only pass (short titles first, so an
 * exactly-titled note is never truncated away) and the broad title+content pass.
 */
async function fetchKeywordCandidates(
  userId: string,
  q: string,
  terms: string[],
): Promise<Note[]> {
  const titleFilters = [
    `title.ilike.${pgOrValue(escapeLikeFilter(q))}`, // exact title
    ilikeContains("title", q),
    ...terms.map((t) => ilikeContains("title", t)),
  ];
  // A sentence question ("how does Nadia want to hear bad news") has no
  // literal substring match, so we OR the phrase with its meaningful terms
  // and rank the union locally: title hits first, then most terms matched.
  const broadFilters = [
    ilikeContains("title", q),
    ilikeContains("content", q),
    ...terms.flatMap((t) => [ilikeContains("title", t), ilikeContains("content", t)]),
  ];

  const [titleRes, broadRes] = await Promise.all([
    supabase
      .from("notes" as any)
      .select(NOTE_COLUMNS)
      .eq("user_id", userId)
      .eq("is_trashed", false)
      .or(titleFilters.join(","))
      .limit(30),
    supabase
      .from("notes" as any)
      .select(NOTE_COLUMNS)
      .eq("user_id", userId)
      .eq("is_trashed", false)
      .or(broadFilters.join(","))
      .order("updated_at", { ascending: false })
      .limit(50),
  ]);
  if (broadRes.error) throw broadRes.error;

  const byId = new Map<string, Note>();
  for (const n of [
    ...((titleRes.data as unknown as Note[]) || []),
    ...((broadRes.data as unknown as Note[]) || []),
  ]) {
    if (!byId.has(n.id)) byId.set(n.id, n);
  }
  return [...byId.values()];
}

/** ILIKE-based instant search (no AI cost) */
export function useIlikeSearch() {
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (query: string): Promise<SemanticSearchResult[]> => {
      const q = query.toLowerCase();
      const terms = extractSearchTerms(query);
      if (isLocalFirstActive()) {
        const notes = await searchNotesLocal(user!.id, q, terms);
        return rankNotesByTerms(notes, q, terms).map((n) => ({ ...n, similarity: null }));
      }
      const notes = await fetchKeywordCandidates(user!.id, q, terms);
      return rankNotesByTerms(notes, q, terms).map((n) => ({ ...n, similarity: null }));
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
      scope = "all",
    }: {
      query: string;
      threshold?: number;
      limit?: number;
      scope?: "all" | "notes" | "media";
    }): Promise<{ results: SemanticSearchResult[]; mode: string }> => {
      const res = await supabase.functions.invoke("search-notes-semantic", {
        // caller: 'app' keeps hidden-from-AI notes in local search results.
        // MCP server passes caller: 'mcp' itself to filter them out.
        body: { query, threshold, limit, scope, caller: "app" },
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
      const terms = extractSearchTerms(query);
      if (isLocalFirstActive()) {
        return rankNotesByTerms(await searchNotesLocal(user!.id, q, terms), q, terms);
      }
      const notes = await fetchKeywordCandidates(user!.id, q, terms);
      return rankNotesByTerms(notes, q, terms);


    },
  });
}
