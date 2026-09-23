-- Index the foreign-key columns that a delete has to search.
--
-- Found by the 2026-09-23 migration audit. When a row is deleted, Postgres
-- looks up every row in every table that references it (to cascade, set null
-- or refuse). Without an index on the referencing column that lookup is a full
-- scan of the child table, once per deleted parent row. The columns below had
-- no index that starts with them; the (user_id, x) indexes some of them have do
-- not serve a lookup by x alone.
--
-- Where it bites: emptying the trash or deleting an account deletes notes one
-- row at a time, and each note then scans review_queue, profile_entries,
-- wiki_page_sources, wiki_revisions, contact_interactions,
-- dismissed_suggestions (twice), gdrive_imports and relationship_repair_items.
-- Deleting a claim scans profile_entries; deleting a contact scans
-- profile_audit_runs; deleting an entity scans collection_items; deleting a
-- wiki page scans wiki_links.
--
-- Columns that are NULL for most rows get a partial index: an equality lookup
-- implies NOT NULL, so the planner can use it, and it stays small.
-- IF NOT EXISTS keeps this safe to re-run.

CREATE INDEX IF NOT EXISTS idx_review_queue_source_note
  ON public.review_queue (source_note_id) WHERE source_note_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_profile_entries_linked_note
  ON public.profile_entries (linked_note_id) WHERE linked_note_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_profile_entries_derived_from_claim
  ON public.profile_entries (derived_from_claim_id) WHERE derived_from_claim_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_wiki_page_sources_note
  ON public.wiki_page_sources (note_id);

CREATE INDEX IF NOT EXISTS idx_wiki_revisions_source_note
  ON public.wiki_revisions (source_note_id) WHERE source_note_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_contact_interactions_note
  ON public.contact_interactions (note_id) WHERE note_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_dismissed_suggestions_source_note
  ON public.dismissed_suggestions (source_note_id);

CREATE INDEX IF NOT EXISTS idx_dismissed_suggestions_target_note
  ON public.dismissed_suggestions (target_note_id);

CREATE INDEX IF NOT EXISTS idx_gdrive_imports_note
  ON public.gdrive_imports (note_id) WHERE note_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_relationship_repair_items_source_note
  ON public.relationship_repair_items (source_note_id) WHERE source_note_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_profile_audit_runs_contact
  ON public.profile_audit_runs (contact_id) WHERE contact_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_collection_items_entity
  ON public.collection_items (entity_id) WHERE entity_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_wiki_links_target_page
  ON public.wiki_links (target_page_id) WHERE target_page_id IS NOT NULL;
