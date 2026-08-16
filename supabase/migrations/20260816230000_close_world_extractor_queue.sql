-- CLOSE THE WORLD EXTRACTOR'S LEFTOVERS ---------------------------------------
--
-- The 2026-08-11 design gave World its own store and a note reader that filed
-- every non-person thing it saw into the review queue. The 2026-08-16 rewrite
-- replaced that with three views over rows that already exist, and said so in
-- its own header: "World is a view over rows that already exist. It is not a
-- new store and it has no extractor of its own."
-- (20260816120000_9a3f61c2-4d70-4c88-9b21-7e0a5c1d3f84.sql)
--
-- The reader was never removed. It kept running for a day and left 336 cards
-- behind that could never be applied even in principle: prepareSuggestionForInsert
-- has no branch for `add_entity` or `add_claim`, so every one of them was written
-- straight to `pending_review` and stayed there. Only 23 were visible; the rest
-- were snoozed and would have surfaced later, a few at a time.
--
-- The reader itself is gone in the same change as this migration. This closes
-- what it already wrote.
--
-- Closed, not deleted, for two reasons. `removed` is exactly what the Roll Back
-- button writes, so these rows end up in the state a human pressing the button
-- would have produced. And a wrong guess about scope is undoable with one
-- statement, where a DELETE is not.
--
-- Rows the user already decided are deliberately untouched: `kept` (2 entities,
-- 2 claims), `removed` (34 + 38) and `blocked` (1, meaning Never Again was
-- pressed). Those are decisions, not damage, and rewriting them would not be
-- cleaning up. `ai_suggestion_suppressions` is left alone for the same reason:
-- it is the only surviving record of which World suggestions were refused on
-- purpose, and no key of that shape can ever be generated again.
--
-- No snooze filter here on purpose: a snoozed row is still queued, it is just
-- not on screen yet.

DO $$
DECLARE
  n integer;
BEGIN
  SELECT count(*) INTO n
    FROM public.review_queue
   WHERE suggestion_type IN ('add_entity', 'add_claim')
     AND status IN ('pending', 'pending_review', 'auto_applied_unreviewed');
  RAISE NOTICE 'world extractor cleanup: closing % review_queue rows', n;
END $$;

UPDATE public.review_queue
   SET status      = 'removed',
       reviewed_at = now()
 WHERE suggestion_type IN ('add_entity', 'add_claim')
   AND status IN ('pending', 'pending_review', 'auto_applied_unreviewed');
