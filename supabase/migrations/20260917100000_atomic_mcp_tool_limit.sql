-- Make the MCP per-tool limit hold under concurrency.
--
-- `enforceMcpToolLimit` in menerio-mcp counted this user's rows in
-- mcp_call_logs for the last minute, compared the count with 60, and only
-- wrote a log row AFTER the tool had run. Every call in a parallel burst
-- therefore read the same count, all of them passed, and none of them was
-- visible to the others until they had finished. The same read-then-write
-- shape that commit 6cc47c64 removed from Mission Control API rate limit
-- (20260909120000_atomic_godspeed_api_rate_limit.sql), and it is fixed the same way:
-- one INSERT ... ON CONFLICT DO UPDATE increments relative to the stored value,
-- Postgres serialises conflicting writers on the primary key, and each caller
-- is told its own count.
--
-- The window is now a fixed minute rather than a sliding one. A client can get
-- up to twice the limit across a minute boundary; it can no longer get an
-- unbounded number inside one minute, which is the property that mattered.
-- Counting happens before the decision, so a refused call still counts.

CREATE TABLE IF NOT EXISTS public.mcp_tool_usage (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tool_name text NOT NULL,
  window_start timestamptz NOT NULL,
  request_count integer NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, tool_name, window_start)
);

COMMENT ON TABLE public.mcp_tool_usage IS
  'Per-user, per-tool call counter for the MCP server, one row per fixed one-minute window. Written only through mcp_tool_bump_usage.';

-- No policies: only the service role (which bypasses RLS) reads or writes it.
ALTER TABLE public.mcp_tool_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mcp_tool_usage FROM PUBLIC;
REVOKE ALL ON TABLE public.mcp_tool_usage FROM anon;
REVOKE ALL ON TABLE public.mcp_tool_usage FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.mcp_tool_usage TO service_role;

CREATE OR REPLACE FUNCTION public.mcp_tool_bump_usage(
  p_user_id uuid,
  p_tool_name text,
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
  v_inserted boolean;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 THEN
    RAISE EXCEPTION 'p_limit must be a positive integer' USING ERRCODE = '22023';
  END IF;
  IF p_user_id IS NULL OR p_tool_name IS NULL OR p_window_start IS NULL THEN
    RAISE EXCEPTION 'p_user_id, p_tool_name and p_window_start are required' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.mcp_tool_usage AS u (user_id, tool_name, window_start, request_count)
  VALUES (p_user_id, p_tool_name, p_window_start, 1)
  ON CONFLICT (user_id, tool_name, window_start)
  DO UPDATE SET request_count = u.request_count + 1
  RETURNING u.request_count, (u.xmax = 0) INTO v_count, v_inserted;

  -- A new window for this tool: clear this user's windows for it that ended
  -- more than an hour ago, so the table stays a handful of rows per user
  -- instead of one row per minute forever. Runs at most once a minute per tool.
  IF v_inserted THEN
    DELETE FROM public.mcp_tool_usage
    WHERE user_id = p_user_id
      AND tool_name = p_tool_name
      AND window_start < p_window_start - interval '1 hour';
  END IF;

  RETURN QUERY SELECT (v_count <= p_limit), v_count;
END;
$$;

COMMENT ON FUNCTION public.mcp_tool_bump_usage(uuid, text, timestamptz, integer) IS
  'Atomically count one MCP tool call in its fixed one-minute window and say whether it is within the limit. Replaces a count-the-logs check that any parallel burst walked straight through.';

-- Only the service role calls this; menerio-mcp holds that key. Leaving it
-- executable by anon/authenticated would let a client inflate or inspect
-- another user''s counter.
REVOKE ALL ON FUNCTION public.mcp_tool_bump_usage(uuid, text, timestamptz, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mcp_tool_bump_usage(uuid, text, timestamptz, integer) FROM anon;
REVOKE ALL ON FUNCTION public.mcp_tool_bump_usage(uuid, text, timestamptz, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_tool_bump_usage(uuid, text, timestamptz, integer) TO service_role;
