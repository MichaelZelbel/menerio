-- A content strike is counted in one statement.
--
-- WHY: `moderate-content` and `ai-moderate-content` read strike_count, added one
-- in the function and wrote the result back. Violations arriving together all
-- read the same count, so five at once added one strike instead of five and the
-- automatic suspension at the limit could be walked around by sending in
-- parallel. A user's first two concurrent strikes both took the insert branch;
-- the second hit UNIQUE (user_id), nobody read that error, and it was lost.
--
-- NOW: one upsert increments and returns the new count, and the suspension is
-- set in the same call when the count reaches the limit. Service role only.

CREATE OR REPLACE FUNCTION public.record_content_strike(p_user_id uuid, p_limit integer, p_reason text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_count integer;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service only' USING errcode = '42501';
  END IF;
  INSERT INTO public.user_suspensions (user_id, strike_count)
  VALUES (p_user_id, 1)
  ON CONFLICT (user_id) DO UPDATE SET strike_count = public.user_suspensions.strike_count + 1
  RETURNING strike_count INTO v_count;

  IF p_limit IS NOT NULL AND v_count >= p_limit THEN
    UPDATE public.user_suspensions
       SET suspended = true,
           suspended_at = now(),
           suspension_reason = p_reason
     WHERE user_id = p_user_id;
  END IF;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.record_content_strike(uuid, integer, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_content_strike(uuid, integer, text) FROM anon;
REVOKE ALL ON FUNCTION public.record_content_strike(uuid, integer, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.record_content_strike(uuid, integer, text) TO service_role;
