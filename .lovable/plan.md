## Media Analysis UI in Note Editor

### Components to create

1. **`src/components/notes/MediaAnalysisOverlay.tsx`** — A React component that renders as an overlay system on images and PDF embeds in the editor:
   - Polls `media_analysis` table for entries matching the current note
   - For each image/PDF with analysis: renders a small badge (sparkle icon = complete, spinner = processing, warning = failed)
   - Uses a portal/absolute-positioned overlay approach since TipTap renders images as plain `<img>` tags
   - Clicking the badge toggles a collapsible panel below the image

2. **`src/components/notes/MediaAnalysisPanel.tsx`** — The expanded analysis detail panel:
   - **Extracted text** section with monospace font, "Copy text" button, fallback "No text detected"
   - **AI description** section with label
   - **Topics** as clickable pills (navigate to search)
   - **Content type** badge
   - **Re-analyze** button that triggers a fresh `analyze-media` call
   - For PDFs: page-by-page collapsible breakdown, "Copy all text" button, page count badge

3. **`src/hooks/useMediaAnalysis.ts`** — Hook to fetch and subscribe to media analysis data for a given note:
   - Queries `media_analysis` where `note_id = noteId`
   - Returns entries keyed by `storage_path`
   - Provides `reanalyze(mediaId)` function

### Integration approach

Since TipTap renders images as plain `<img>` DOM elements, we'll use a **DOM observer pattern**:
- After editor renders, scan for `img` elements and `iframe[data-type='pdf']` in the editor content
- Extract `src` URLs, match against `media_analysis` entries by `storage_path` or URL
- Render overlay badges as React portals positioned relative to each media element
- Use `MutationObserver` to re-scan when editor content changes

### Changes to existing files

- **`src/components/notes/NoteEditor.tsx`** — Import and render `<MediaAnalysisOverlay>` inside the editor area, passing `noteId` and a ref to the editor container div

### Not changed
- No changes to markdown export — analysis panels are render-only UI, not part of the document model
- No changes to edge functions
