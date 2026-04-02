

# Public Note Sharing (Evernote-style)

## What it does
One-click "Share" action on any note that generates a public URL, copies it to clipboard, and makes the note viewable by anyone with the link — no login required.

## Architecture

### 1. Database: `shared_notes` table + migration
- `id` (uuid, PK), `note_id` (uuid, FK to notes, unique), `user_id` (uuid, FK to auth.users), `share_token` (text, unique, indexed — short random string), `is_active` (boolean, default true), `created_at`, `updated_at`
- RLS: authenticated users can manage their own rows
- A SELECT policy for `anon` role: allow selecting shared_notes + joining to notes where `is_active = true` and token matches (handled via a security-definer function instead)

### 2. Edge function: `get-shared-note`
- Public endpoint (no auth required)
- Accepts `token` query param
- Looks up `shared_notes` by `share_token` where `is_active = true`
- Fetches the note content (title, content, created_at, updated_at, entity_type, tags) — NOT metadata, embedding, or user_id
- Returns sanitized note data as JSON
- Returns 404 if token invalid or share is inactive

### 3. Public viewer page: `/shared/:token`
- New route outside the dashboard (no auth required), inside `PageLayout`
- Fetches note via the edge function
- Renders a read-only view: title, content (rendered from Tiptap-compatible HTML/markdown), tags, date
- Clean, minimal design with Menerio branding
- "Powered by Menerio" footer link

### 4. Share action in NoteEditor
- Add "Share note" `DropdownMenuItem` with a `Share2` icon to the existing overflow menu (next to "Copy Note Link")
- On click: upsert a row in `shared_notes` with a generated token, copy the public URL to clipboard, show toast "Public link copied to clipboard"
- If already shared: show "Copy public link" (copies existing URL) and "Stop sharing" (sets `is_active = false`)
- Small share indicator (globe icon) in the editor header when a note is actively shared

### 5. Share token generation
- Use a short, URL-friendly random string (e.g., 12-char alphanumeric via `crypto.randomUUID().replace(/-/g, '').slice(0, 12)`)

## Files to create/modify
- **New migration**: `shared_notes` table
- **New edge function**: `supabase/functions/get-shared-note/index.ts`
- **New page**: `src/pages/SharedNote.tsx` — public viewer
- **Modified**: `src/App.tsx` — add `/shared/:token` route
- **Modified**: `src/components/notes/NoteEditor.tsx` — add share menu items + share indicator
- **Modified**: `src/hooks/useNotes.ts` — add share/unshare mutation helpers

