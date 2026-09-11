-- Same numbers, 10.7 times faster.
--
-- The 2026-09-11 version computed `max_runs_per_note` with a correlated subquery
-- over the `per_note` CTE. Postgres cannot hoist that, so it re-scanned the whole
-- CTE once per output group: 1,325 passes over 20,295 rows, discarding 20,294 of
-- them each time. Measured on production: 2,797 ms total, of which the seq scan
-- was 22 ms and the subquery was the other 2,775 ms.
--
-- Aggregating per_note down to one row per (user_id, day, feature) and joining it
-- turns those 1,325 passes into a single extra grouping pass. Measured after:
-- 261 ms. Verified identical before applying: both versions return 1,325 rows and
-- `EXCEPT` in both directions is empty.
--
-- Column list, types, comment and security_invoker are unchanged on purpose. This
-- is a plan fix, not a contract change.

CREATE OR REPLACE VIEW public.llm_spend_daily WITH (security_invoker = true) AS
WITH ev AS (
  SELECT user_id,
         (created_at AT TIME ZONE 'UTC')::date AS day,
         feature,
         note_id,
         total_tokens,
         credits_charged
  FROM public.llm_usage_events
),
per_note AS (
  SELECT user_id, day, feature, max(runs) AS max_runs_per_note
  FROM (
    SELECT user_id, day, feature, note_id, count(*) AS runs
    FROM ev
    WHERE note_id IS NOT NULL
    GROUP BY 1, 2, 3, 4
  ) note_runs
  GROUP BY 1, 2, 3
)
SELECT ev.user_id,
       ev.day,
       ev.feature,
       count(*)::bigint AS calls,
       sum(ev.total_tokens)::bigint AS tokens,
       sum(ev.credits_charged)::bigint AS credits_ceil,
       round(sum(ev.total_tokens) / 2000.0, 1) AS credits_exact,
       count(DISTINCT ev.note_id)::bigint AS notes,
       pn.max_runs_per_note
FROM ev
LEFT JOIN per_note pn USING (user_id, day, feature)
GROUP BY ev.user_id, ev.day, ev.feature, pn.max_runs_per_note;

COMMENT ON VIEW public.llm_spend_daily IS
  'Per account, day and feature: calls, tokens, ledger credits (ceil per event), exact credits (tokens/2000), distinct notes and the most runs one note got that day. Added 2026-09-11 after the checkbox-revision audit.';

REVOKE ALL ON public.llm_spend_daily FROM public, anon;
GRANT SELECT ON public.llm_spend_daily TO authenticated, service_role;
