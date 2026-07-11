-- Cleanup: remove empty per-contact DEFAULT profile categories.
--
-- The People UX redesign no longer seeds/shows empty taxonomy categories on a
-- contact profile (sections render only once a fact is filed into them, and the
-- new AI quick-add materializes a category on demand via ensureProfileCategory).
-- Older contacts still carry a full set of seeded is_default categories with no
-- entries. Delete those, but ONLY when nothing references them:
--   1. no profile_entries live in the category, AND
--   2. no still-open review_queue suggestion is destined for it.
--
-- review_queue's "still open" statuses are pending / pending_review /
-- auto_applied_unreviewed (see _shared/profile-normalization.ts,
-- enrich-person-from-lexicon, and migration 20260514203033). The destination
-- category id is stored at payload->>'category_id' (see process-note/index.ts
-- where add_profile_entry suggestions are built). Held back from the feature
-- migration so it can be applied deliberately.

DELETE FROM public.profile_categories pc
WHERE pc.contact_id IS NOT NULL
  AND pc.is_default = true
  AND NOT EXISTS (
    SELECT 1 FROM public.profile_entries pe
    WHERE pe.category_id = pc.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.review_queue rq
    WHERE rq.status IN ('pending', 'pending_review', 'auto_applied_unreviewed')
      AND rq.payload->>'category_id' = pc.id::text
  );
