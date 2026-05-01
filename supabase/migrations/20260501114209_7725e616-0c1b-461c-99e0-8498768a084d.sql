-- 1. Deduplicate ai_allowance_periods rows.
-- Keep the row with the highest tokens_used per (user_id, period_start, period_end).
-- Sum any usage from the duplicates into the survivor so we don't lose tracked consumption.

WITH grouped AS (
  SELECT
    user_id,
    period_start,
    period_end,
    SUM(tokens_used)::bigint AS sum_used
  FROM public.ai_allowance_periods
  GROUP BY user_id, period_start, period_end
  HAVING COUNT(*) > 1
),
ranked AS (
  SELECT
    p.id,
    p.user_id,
    p.period_start,
    p.period_end,
    ROW_NUMBER() OVER (
      PARTITION BY p.user_id, p.period_start, p.period_end
      ORDER BY p.tokens_used DESC, p.created_at ASC, p.id ASC
    ) AS rn
  FROM public.ai_allowance_periods p
  JOIN grouped g
    ON g.user_id = p.user_id
   AND g.period_start = p.period_start
   AND g.period_end = p.period_end
),
survivors AS (
  SELECT id, user_id, period_start, period_end
  FROM ranked WHERE rn = 1
)
UPDATE public.ai_allowance_periods ap
SET tokens_used = g.sum_used,
    updated_at = now()
FROM survivors s
JOIN grouped g
  ON g.user_id = s.user_id
 AND g.period_start = s.period_start
 AND g.period_end = s.period_end
WHERE ap.id = s.id;

-- Delete the losing duplicates.
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY user_id, period_start, period_end
      ORDER BY tokens_used DESC, created_at ASC, id ASC
    ) AS rn
  FROM public.ai_allowance_periods
)
DELETE FROM public.ai_allowance_periods ap
USING ranked r
WHERE ap.id = r.id
  AND r.rn > 1;

-- 2. Prevent recurrence with a unique constraint on the period key.
CREATE UNIQUE INDEX IF NOT EXISTS ai_allowance_periods_user_period_uniq
  ON public.ai_allowance_periods (user_id, period_start, period_end);
