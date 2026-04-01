## Enhanced Search Integration & Media Library

### 1. Database: `match_media` RPC function
Create a new `match_media` RPC (similar to `match_notes`) that searches `media_analysis` embeddings and returns matching entries with their parent note info.

### 2. Edge function: `search-notes-semantic`
Update to:
- Accept a `scope` parameter: `"all"` (default), `"notes"`, `"media"`
- When scope includes media, call `match_media` RPC in parallel with `match_notes`
- Deduplicate results by note_id, keeping the higher similarity score
- Return `match_source` field: `"note"`, `"media"`, or `"both"`
- Include media match details: `media_description`, `media_storage_path`, `media_type`

### 3. Frontend search types update (`src/hooks/useNotes.ts`)
- Extend `SemanticSearchResult` with optional `match_source`, `media_description`, `media_storage_path`
- Pass `scope` parameter to the edge function

### 4. Search UI updates (`src/pages/Notes.tsx`)
- Add a third search scope toggle: "All" / "Notes" / "Media"
- Pass scope to `semanticSearch.mutate()`

### 5. Note list updates (`src/components/notes/NoteList.tsx`)
- For results with `match_source === "media"` or `"both"`, show:
  - Small image thumbnail from `media_storage_path`
  - "Matched in image/PDF" label with AI description subtitle
  - Combined indicator for "both" matches

### 6. Media Library page (`src/pages/MediaLibrary.tsx`)
- Grid view of all `media_analysis` entries with thumbnails
- Search bar (semantic, searches media embeddings only)
- Filter by content_type, date range, topic
- Status summary: X analyzed, Y pending, Z failed
- Click to navigate to parent note
- Add route and sidebar entry

### Files changed
- New migration: `match_media` RPC
- `supabase/functions/search-notes-semantic/index.ts`
- `src/hooks/useNotes.ts`
- `src/pages/Notes.tsx`
- `src/components/notes/NoteList.tsx`
- New: `src/pages/MediaLibrary.tsx`
- `src/App.tsx` — add route
- `src/components/layout/DashboardSidebar.tsx` — add sidebar item
