-- B1 snapshot for the fact store go-live (docs/plans/one-fact-store.md, B1 and 5.4).
--
-- Copies the five tables the switch changes into schema fact_backup, inside the
-- database. Nothing is exported. The schema is closed to the API roles and is
-- not in the API's exposed schemas. fact_store_rollback.sql restores from it.
-- Dropped 14 days after Part C.
--
-- Run once, after every fact writer is paused. Refuses to overwrite a snapshot.

DO $$
BEGIN
  IF to_regnamespace('fact_backup') IS NOT NULL THEN
    RAISE EXCEPTION 'fact_backup already exists; drop it deliberately before taking a new snapshot';
  END IF;
END $$;

CREATE SCHEMA fact_backup;
REVOKE ALL ON SCHEMA fact_backup FROM public, anon, authenticated;

CREATE TABLE fact_backup.meta AS
SELECT now() AS taken_at,
       (SELECT jsonb_object_agg(c.relname, jsonb_build_object(
                 'rls', c.relrowsecurity,
                 'policies', (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid)))
          FROM pg_class c
         WHERE c.relnamespace = 'public'::regnamespace
           AND c.relname IN ('profile_entries','profile_categories','claims','review_queue','ai_suggestion_suppressions')) AS b16;

CREATE TABLE fact_backup.profile_entries AS TABLE public.profile_entries;
CREATE TABLE fact_backup.profile_categories AS TABLE public.profile_categories;
CREATE TABLE fact_backup.claims AS TABLE public.claims;
CREATE TABLE fact_backup.review_queue AS TABLE public.review_queue;
CREATE TABLE fact_backup.ai_suggestion_suppressions AS TABLE public.ai_suggestion_suppressions;
REVOKE ALL ON ALL TABLES IN SCHEMA fact_backup FROM public, anon, authenticated;

DO $$
DECLARE
  t text;
  live bigint;
  kept bigint;
BEGIN
  FOREACH t IN ARRAY ARRAY['profile_entries','profile_categories','claims','review_queue','ai_suggestion_suppressions'] LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', t) INTO live;
    EXECUTE format('SELECT count(*) FROM fact_backup.%I', t) INTO kept;
    IF live <> kept THEN RAISE EXCEPTION 'fact_backup: % has % rows, the snapshot %', t, live, kept; END IF;
  END LOOP;
END $$;

SELECT 'fact_backup' AS snapshot,
       (SELECT count(*) FROM fact_backup.profile_entries) AS profile_entries,
       (SELECT count(*) FROM fact_backup.profile_categories) AS profile_categories,
       (SELECT count(*) FROM fact_backup.claims) AS claims,
       (SELECT count(*) FROM fact_backup.review_queue) AS review_queue,
       (SELECT count(*) FROM fact_backup.ai_suggestion_suppressions) AS ai_suggestion_suppressions;
