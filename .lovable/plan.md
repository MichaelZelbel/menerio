Add two new tools to `supabase/functions/open-brain-mcp/index.ts`. No DB migration, no new secrets. Hard-delete is intentionally omitted as a safety net — only the user can permanently delete via the UI.

## 1. `update_note`
- **Input**: `note_id` (required), optional `title`, `content` (Markdown), `tags`, `folder_path`, `is_favorite`, `is_pinned`
- **Logic**: fetch note → verify `user_id === currentUserId` → reject if `is_external` (with hint to duplicate first) → `UPDATE` only fields that were passed → return updated row
- **Description for agent**: "Edit an existing note's title, content (Markdown), tags, folder, favorite, or pinned state. Only fields you pass are changed. External (synced) notes cannot be edited directly."

## 2. `trash_note`
- **Input**: `note_id` (required), `restore` (boolean, default `false`)
- **Logic**: owner check → set `is_trashed` + `trashed_at` (or unset both on restore)
- **Description for agent**: "Move a note to trash (reversible — user can restore from Trash view). Use this when the user wants to delete or remove a note. Permanent deletion is intentionally NOT available to agents — only the user can hard-delete from the UI. Pass `restore: true` to bring a trashed note back."

## Implementation notes
- Follow existing pattern in the file: `server.registerTool(...)` with Zod schemas, `jsonTool({...})` for return, manual `currentUserId` ownership check (consistent with all other tools).
- Insert both tools right before the existing `get_stats` tool (~line 633).
- No changes elsewhere.
