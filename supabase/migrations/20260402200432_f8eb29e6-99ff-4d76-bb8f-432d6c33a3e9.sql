CREATE UNIQUE INDEX IF NOT EXISTS idx_notes_source_dedup
ON notes (user_id, source_app, source_id)
WHERE source_app IS NOT NULL AND source_id IS NOT NULL;