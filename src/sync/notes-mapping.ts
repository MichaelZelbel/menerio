import type { Note, RelatedItem } from "@/hooks/useNotes";

// Raw shape of a `notes` row as stored in local SQLite (see sync/schema.ts):
// JSON columns are text, booleans are 0/1.
export interface NoteRow {
  id: string;
  user_id: string;
  title: string | null;
  content: string | null;
  metadata: string | null;
  tags: string | null;
  is_favorite: number | null;
  is_pinned: number | null;
  is_trashed: number | null;
  trashed_at: string | null;
  entity_type: string | null;
  source_app: string | null;
  source_id: string | null;
  source_url: string | null;
  folder_path: string | null;
  is_external: number | null;
  sync_status: string | null;
  structured_fields: string | null;
  related: string | null;
  ai_visibility: string | null;
  created_at: string | null;
  updated_at: string | null;
}

function parseJson<T>(value: string | null, fallback: T): T {
  if (value == null || value === "") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function rowToNote(row: NoteRow): Note {
  return {
    id: row.id,
    user_id: row.user_id,
    title: row.title ?? "",
    content: row.content ?? "",
    metadata: parseJson<Record<string, unknown> | null>(row.metadata, null),
    tags: parseJson<string[]>(row.tags, []),
    is_favorite: !!row.is_favorite,
    is_pinned: !!row.is_pinned,
    is_trashed: !!row.is_trashed,
    trashed_at: row.trashed_at,
    entity_type: row.entity_type,
    source_app: row.source_app,
    source_id: row.source_id,
    source_url: row.source_url,
    folder_path: row.folder_path ?? "",
    is_external: !!row.is_external,
    sync_status: row.sync_status ?? "synced",
    structured_fields: parseJson<Record<string, unknown>>(row.structured_fields, {}),
    related: parseJson<RelatedItem[]>(row.related, []),
    ai_visibility: row.ai_visibility === "hidden" ? "hidden" : "visible",
    created_at: row.created_at ?? "",
    updated_at: row.updated_at ?? "",
  };
}

// Serialize a JS value into its local-SQLite representation for a notes column.
export function toSqliteValue(column: string, value: unknown): unknown {
  if (value === undefined) return undefined;
  switch (column) {
    case "tags":
    case "metadata":
    case "structured_fields":
    case "related":
      return value == null ? null : JSON.stringify(value);
    case "is_favorite":
    case "is_pinned":
    case "is_trashed":
    case "is_external":
      return value ? 1 : 0;
    default:
      return value;
  }
}
