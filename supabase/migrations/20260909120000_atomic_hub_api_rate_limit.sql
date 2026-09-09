-- Make the Hub API rate limit hold under concurrency.
--
-- `_shared/hub-rate-limit.ts` read the window's counter, decided, then wrote the
-- absolute value back:
--
--     SELECT request_count ...           -- every caller reads the same C
--     if (C >= LIMIT) reject
--     UPSERT request_count = C + 1       -- every caller writes the same C + 1
--
-- Its own comment called the resulting race "a small benign race … undercounting
-- slightly". It is not slight. Because the write is an absolute value rather than
-- an increment, N requests issued in parallel all read C and all write C + 1, so
-- the counter advances by ONE for the whole burst. Measured against a limit of 5:
-- 100 concurrent requests, 100 allowed, final stored count 1. Any caller willing
-- to open connections in parallel — which is the only caller a throttle exists to
-- stop — was effectively unlimited.
--
-- The comment said the real fix needed the column types confirmed. They are:
-- window_start is timestamptz, request_count is integer, and there is already a
-- UNIQUE (key_id, window_start) constraint (hub_api_keys_scope_backup migration
-- 20260402165028) for ON CONFLICT to target.
--
-- The increment now happens inside one statement, so Postgres serialises the
-- conflicting writers on the unique index and each one sees its own count.
-- Counting BEFORE deciding is deliberate: a refused request still advances the
-- counter, so a client that keeps hammering cannot get a cheaper read path than
-- one that backs off, and the fixed window clears it anyway.

CREATE OR REPLACE FUNCTION public.hub_api_bump_usage(
  p_key_id uuid,
  p_window_start timestamptz,
  p_limit integer
)
RETURNS TABLE (allowed boolean, request_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 THEN
    RAISE EXCEPTION 'p_limit must be a positive integer' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.hub_api_usage AS u (key_id, window_start, request_count)
  VALUES (p_key_id, p_window_start, 1)
  ON CONFLICT (key_id, window_start)
  DO UPDATE SET request_count = u.request_count + 1
  RETURNING u.request_count INTO v_count;

  RETURN QUERY SELECT (v_count <= p_limit), v_count;
END;
$$;

COMMENT ON FUNCTION public.hub_api_bump_usage(uuid, timestamptz, integer) IS
  'Atomically count one Hub API request in its fixed window and say whether it is within the limit. Replaces a read-then-write check that any parallel burst walked straight through.';

-- Only the service role calls this; the edge function holds that key. Leaving it
-- executable by anon/authenticated would let a client inflate or inspect another
-- key''s counter.
REVOKE ALL ON FUNCTION public.hub_api_bump_usage(uuid, timestamptz, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hub_api_bump_usage(uuid, timestamptz, integer) FROM anon;
REVOKE ALL ON FUNCTION public.hub_api_bump_usage(uuid, timestamptz, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.hub_api_bump_usage(uuid, timestamptz, integer) TO service_role;
