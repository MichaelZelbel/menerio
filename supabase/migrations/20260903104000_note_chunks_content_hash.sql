-- Stop re-embedding a chunk that did not change.
--
-- `embedAndStoreNoteChunks` re-embeds every chunk of a note on every run, up to
-- MAX_CHUNKS_PER_NOTE = 50. So changing one word in a long note pays for 50
-- embeddings to store 49 vectors that were already correct. In the 7 days to
-- 2026-09-03 that was 1,236 embedding calls and 573,000 tokens.
--
-- The hash is of the EMBEDDING INPUT, not the raw chunk text: what
-- `buildEmbeddingInput(noteTitle, chunk)` produced is what the provider actually
-- saw, so it is the only thing that can safely key a cached vector. That does
-- mean a title edit invalidates every chunk of the note, which is correct rather
-- than unfortunate: the input really did change.
--
-- Backfill is deliberately absent. Existing rows keep content_hash NULL and are
-- re-embedded once, the next time their note is processed, which is what the
-- code already does today. Nothing degrades and nothing needs a migration run.

ALTER TABLE public.note_chunks
  ADD COLUMN IF NOT EXISTS content_hash text;

COMMENT ON COLUMN public.note_chunks.content_hash IS
  'SHA-256 of the exact string that was embedded (buildEmbeddingInput output). A chunk whose hash is unchanged reuses its stored vector instead of paying to embed it again. NULL means "hash unknown", which forces a re-embed.';

CREATE INDEX IF NOT EXISTS note_chunks_content_hash_idx
  ON public.note_chunks (note_id, content_hash);
