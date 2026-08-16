import { supabase } from "@/integrations/supabase/client";
import { OFFLINE_CORE } from "@/lib/flags";
import { getDb } from "./db";
import { rowToNote, toSqliteValue, type NoteRow } from "./notes-mapping";
import type { Note } from "@/hooks/useNotes";

// Columns of the local `notes` table, in the order used by upserts.
const NOTE_COLUMNS = [
  "id",
  "user_id",
  "title",
  "content",
  "metadata",
  "tags",
  "is_favorite",
  "is_pinned",
  "is_trashed",
  "trashed_at",
  "entity_type",
  "source_app",
  "source_id",
  "source_url",
  "folder_path",
  "is_external",
  "sync_status",
  "structured_fields",
  "related",
  "ai_visibility",
  "created_at",
  "updated_at",
] as const;

function noteToParams(note: Note): unknown[] {
  const source = note as unknown as Record<string, unknown>;
  return NOTE_COLUMNS.map((col) => {
    const value = source[col];
    const serialized = toSqliteValue(col, value === undefined ? null : value);
    return serialized === undefined ? null : serialized;
  });
}

/**
 * Write server rows into the local SQLite replica.
 *
 * WARNING, and the previous comment here had this exactly backwards. It claimed
 * `INSERT OR REPLACE` mirrors the download stream so the rows are treated as
 * synced state and are NOT queued for upload. They ARE queued. In PowerSync
 * `notes` is a view with INSTEAD OF triggers that funnel every SQL write into
 * the CRUD queue; the real download stream writes to the underlying
 * `ps_data__notes` and bypasses those triggers, which SQL from here cannot do.
 *
 * So every row written here becomes a full-row PUT that is replayed on the next
 * successful connect (`connector.ts`, UpdateType.PUT). Repairing 638 notes
 * therefore queues 638 server-side upserts, each bumping `updated_at` and
 * re-firing `process-note`. The values are the server's own, so nothing is
 * corrupted, but it is not free and it is not silent on the server.
 */
export async function upsertNotesLocal(notes: Note[]): Promise<number> {
  if (!OFFLINE_CORE || notes.length === 0) return 0;
  const db = getDb();
  const placeholders = NOTE_COLUMNS.map(() => "?").join(", ");
  const sql = `INSERT OR REPLACE INTO notes (${NOTE_COLUMNS.join(", ")}) VALUES (${placeholders})`;
  await db.writeTransaction(async (tx) => {
    for (const note of notes) {
      await tx.execute(sql, noteToParams(note));
    }
  });
  return notes.length;
}

/** True when the local replica has no row with this id. */
export async function isMissingLocally(id: string): Promise<boolean> {
  if (!OFFLINE_CORE) return false;
  const row = await getDb().get<{ n: number }>(
    "SELECT count(*) AS n FROM notes WHERE id = ?",
    [id],
  );
  return (row?.n ?? 0) === 0;
}

/** Newest `updated_at` known locally for a note, or null when absent. */
export async function localNoteUpdatedAt(id: string): Promise<string | null> {
  if (!OFFLINE_CORE) return null;
  const row = await getDb().getOptional<{ updated_at: string | null }>(
    "SELECT updated_at FROM notes WHERE id = ?",
    [id],
  );
  return row?.updated_at ?? null;
}

export interface ReplicaDiagnostics {
  localTotal: number;
  localFavorites: number;
  serverTotal: number;
  serverFavorites: number;
  missingIds: string[];
  connected: boolean;
  lastSyncedAt: string | null;
  pendingUploads: number;
}

const MISSING_SAMPLE = 25;

/** Compare the local replica against the server for the signed-in user. */
export async function getReplicaDiagnostics(userId: string): Promise<ReplicaDiagnostics> {
  const db = getDb();

  const [localCounts, serverRows, uploadStats] = await Promise.all([
    db.get<{ total: number; favorites: number }>(
      "SELECT count(*) AS total, sum(case when is_favorite = 1 then 1 else 0 end) AS favorites FROM notes WHERE user_id = ? AND is_trashed = 0",
      [userId],
    ),
    supabase
      .from("notes" as never)
      .select("id, is_favorite")
      .eq("user_id", userId)
      .eq("is_trashed", false),
    db.getUploadQueueStats().catch(() => ({ count: 0 })),
  ]);

  const server = ((serverRows.data as unknown as { id: string; is_favorite: boolean }[]) || []);
  const localIds = new Set(
    (
      await db.getAll<{ id: string }>("SELECT id FROM notes WHERE user_id = ?", [userId])
    ).map((r) => r.id),
  );
  const missingIds = server.filter((r) => !localIds.has(r.id)).map((r) => r.id);

  const status = db.currentStatus;
  return {
    localTotal: localCounts?.total ?? 0,
    localFavorites: localCounts?.favorites ?? 0,
    serverTotal: server.length,
    serverFavorites: server.filter((r) => r.is_favorite).length,
    missingIds: missingIds.slice(0, MISSING_SAMPLE),
    connected: !!status?.connected,
    lastSyncedAt: status?.lastSyncedAt ? new Date(status.lastSyncedAt).toISOString() : null,
    pendingUploads: (uploadStats as { count?: number })?.count ?? 0,
  };
}

/**
 * Pull every server note for the user and upsert it locally. Pending local
 * writes are untouched — this only fills gaps / refreshes downloaded state.
 */
export async function repairLocalReplica(userId: string): Promise<number> {
  const pageSize = 500;
  let from = 0;
  let repaired = 0;

  for (;;) {
    const { data, error } = await supabase
      .from("notes" as never)
      .select("*")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const rows = (data as unknown as Note[]) || [];
    if (rows.length === 0) break;
    repaired += await upsertNotesLocal(rows);
    if (rows.length < pageSize) break;
    from += pageSize;
  }

  return repaired;
}

/** Read a single note back out of the local replica (for verification). */
export async function readLocalNote(id: string): Promise<Note | null> {
  if (!OFFLINE_CORE) return null;
  const row = await getDb().getOptional<NoteRow>("SELECT * FROM notes WHERE id = ?", [id]);
  return row ? rowToNote(row) : null;
}
