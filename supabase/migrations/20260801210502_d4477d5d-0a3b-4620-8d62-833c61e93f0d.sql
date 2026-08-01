ALTER TABLE public.wiki_pages
  ADD COLUMN IF NOT EXISTS restructure_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS restructure_last_error text,
  ADD COLUMN IF NOT EXISTS restructure_blocked_until timestamptz,
  ADD COLUMN IF NOT EXISTS restructure_content_hash text;

CREATE INDEX IF NOT EXISTS idx_wiki_pages_restructure_gate
  ON public.wiki_pages (restructure_blocked_until);

-- Slow the Lexicon restructure sweep: every 6 hours, 10 pages per run.
SELECT cron.unschedule(5);
SELECT cron.schedule(
  'wiki-restructure-sweep',
  '22 */6 * * *',
  $$
  SELECT net.http_post(
    url := 'https://tjeapelvjlmbxafsmjef.supabase.co/functions/v1/wiki-restructure',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRqZWFwZWx2amxtYnhhZnNtamVmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI5MTk3MDUsImV4cCI6MjA4ODQ5NTcwNX0.xzux7CmiNNDdtcjaPvuJRqs8_ZtiljbDjim4Mdm4siU'
    ),
    body := jsonb_build_object('cron', 'wiki-restructure', 'limit', 10)
  );
  $$
);