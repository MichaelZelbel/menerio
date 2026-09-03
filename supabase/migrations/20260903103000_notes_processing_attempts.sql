-- Give up on a note that can never be processed, instead of paying for it forever.
--
-- `sweep-note-processing` decides what to re-run with `needsWork()`, and two of
-- its branches were unconditional:
--
--   if (status === "failed")   return true;              // every sweep, forever
--   if (status === "processed") return !row.embedding;    // every sweep, forever
--
-- There was no attempt counter anywhere in the repo, so a note that fails for a
-- reason that will never change (malformed content, a shape the extractor cannot
-- parse) was re-processed on every single sweep. Each attempt pays for a metadata
-- extraction before it reaches the failure. Found in the spend audit of
-- 2026-09-03, alongside 42 notes on one account sitting at status NULL with no
-- embedding, which is the same branch.
--
-- Three strikes, then the note stops costing money and says why. A human editing
-- the note is a real change and resets the count, because the next attempt is
-- then attempting something different.

ALTER TABLE public.notes
  ADD COLUMN IF NOT EXISTS processing_attempts integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.notes.processing_attempts IS
  'Consecutive AI processing attempts that did not end in success. Reset to 0 when the content changes or a run succeeds. sweep-note-processing stops retrying at 3.';

-- Partial index: the sweep only ever reads this for notes that are not yet done.
CREATE INDEX IF NOT EXISTS notes_processing_attempts_idx
  ON public.notes (user_id, processing_attempts)
  WHERE processing_status IS DISTINCT FROM 'processed';

-- Existing notes start from zero, so nothing already in the queue is given up on
-- because of this migration.
