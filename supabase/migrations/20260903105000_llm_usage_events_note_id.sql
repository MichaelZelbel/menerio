-- Make "which note did we pay to extract, and how often" a one-line query.
--
-- The spend audit of 2026-09-03 could show that one account ran 107
-- `process-note.metadata` extractions across at most 24 notes in September,
-- roughly 4.5 per note, but not WHICH notes or WHY. The ledger records the
-- feature, the model and the cost, and nothing tying a row to its subject, so
-- telling genuine re-edits apart from a re-trigger loop needed an inference
-- rather than a query.
--
-- Nullable and unbackfilled on purpose: only note-scoped call sites set it, and
-- rows written before today keep NULL.

ALTER TABLE public.llm_usage_events
  ADD COLUMN IF NOT EXISTS note_id uuid;

COMMENT ON COLUMN public.llm_usage_events.note_id IS
  'The note this call was about, for note-scoped call sites. NULL for everything else. Added 2026-09-03 so repeated extraction of one note is measurable rather than inferred.';

CREATE INDEX IF NOT EXISTS llm_usage_events_note_idx
  ON public.llm_usage_events (note_id, created_at DESC)
  WHERE note_id IS NOT NULL;
