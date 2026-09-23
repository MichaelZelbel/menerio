-- Duplicate indexes on public.notes.
--
-- 20260308134001 created notes_metadata_idx gin(metadata), notes_tags_idx
-- gin(tags) and notes_user_created_idx (user_id, created_at desc). Later
-- migrations added the same indexes again under other names with
-- IF NOT EXISTS, which only checks the name, so both copies exist:
--   idx_notes_tags      gin (tags)        20260328154149, same as notes_tags_idx
--   idx_notes_metadata  gin (metadata)    20260329200632, same as notes_metadata_idx
--   idx_notes_user_id   btree (user_id)   20260328154149, a prefix of
--                       notes_user_created_idx and notes_user_active_idx
--
-- A note save is never a HOT update (updated_at is indexed), so every
-- autosave writes an entry into every index on the table; a GIN index on the
-- whole metadata document is one of the more expensive ones to maintain.
-- The planner can only ever use one copy. Dropping the later copies halves
-- that GIN write work and the storage, and changes no query plan.
drop index if exists public.idx_notes_metadata;
drop index if exists public.idx_notes_tags;
drop index if exists public.idx_notes_user_id;

-- Unused expression index. idx_notes_content_fts (20260328154149) indexes
-- to_tsvector('german', content), and Postgres only uses an expression index
-- for a query that repeats that exact expression. Nothing in this repository
-- does: no function, view, RPC, edge function or client query calls
-- to_tsvector('german', ...) on notes (keyword search uses ILIKE and the
-- embeddings). Yet every note save, autosaves included, re-runs the German
-- stemmer over the whole body and rewrites its GIN entries.
drop index if exists public.idx_notes_content_fts;
