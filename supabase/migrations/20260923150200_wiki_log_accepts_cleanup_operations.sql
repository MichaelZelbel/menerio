-- Let wiki_log record what wiki-cleanup does.
--
-- Found by the 2026-09-23 audit. wiki_log.operation carries a CHECK
-- constraint (last set in 20260726103126) that allows ingest, ingest_skipped,
-- ingest_failed, lint, lint_failed, restructure and restructure_dry_run.
-- wiki-cleanup writes five more values: strip_dead_links,
-- strip_dead_links_preview, rebuild_page, cleanup and cleanup_preview
-- (supabase/functions/wiki-cleanup/index.ts). It does not check the insert's
-- error, so every one of those log rows has been refused without a trace:
-- Lexicon page rebuilds and deletions left no record at all.
--
-- The list below is every value any function writes today (wiki-ingest,
-- wiki-lint, wiki-restructure, wiki-cleanup). Widening a CHECK cannot fail on
-- existing rows, since every existing row passed the narrower one.

ALTER TABLE public.wiki_log DROP CONSTRAINT IF EXISTS wiki_log_operation_check;
ALTER TABLE public.wiki_log ADD CONSTRAINT wiki_log_operation_check CHECK (operation = ANY (ARRAY[
  'ingest', 'ingest_skipped', 'ingest_failed',
  'lint', 'lint_failed',
  'restructure', 'restructure_dry_run',
  'strip_dead_links', 'strip_dead_links_preview',
  'rebuild_page',
  'cleanup', 'cleanup_preview'
]));
