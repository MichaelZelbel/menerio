import { column, Schema, Table } from "@powersync/web";

// Client-side schema for the synced core subset. Column types follow
// PowerSync's SQLite mapping of the Postgres schema:
// booleans -> integer 0/1, jsonb & text[] -> JSON text, timestamptz -> ISO text.
// `id` is implicit (TEXT primary key). `embedding` is deliberately absent —
// vectors never sync to devices.
//
// When a Postgres migration adds a column that the UI reads, add it here AND
// to the PowerSync sync rules, or it will silently not sync.
const notes = new Table(
  {
    user_id: column.text,
    title: column.text,
    content: column.text,
    metadata: column.text,
    tags: column.text,
    is_favorite: column.integer,
    is_pinned: column.integer,
    is_trashed: column.integer,
    trashed_at: column.text,
    entity_type: column.text,
    source_app: column.text,
    source_id: column.text,
    source_url: column.text,
    folder_path: column.text,
    is_external: column.integer,
    sync_status: column.text,
    structured_fields: column.text,
    related: column.text,
    ai_visibility: column.text,
    created_at: column.text,
    updated_at: column.text,
  },
  {
    indexes: {
      user_active: ["user_id", "is_trashed", "updated_at"],
    },
  },
);

export const AppSchema = new Schema({ notes });
