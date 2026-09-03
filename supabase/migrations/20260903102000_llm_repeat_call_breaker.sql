-- The safety net for the whole class of bug found on 2026-09-03.
--
-- Nothing in Menerio noticed that it was sending the AI a question it had
-- already asked. `profile-audit.main` asked the identical question (1,919 prompt
-- tokens, 156 completion tokens, byte for byte) 1,733 times across 52 hours and
-- 2.27 million tokens, and every layer let it through: the balance pre-check saw
-- a healthy balance, the deduction recorded a real cost, and the ledger grew.
-- Each individual call was correct. Only the repetition was wrong, and nothing
-- was looking at repetition.
--
-- Fixing the specific bug (20260903100000) does not stop the next one. This does.
--
-- A dozen identical prompts from the same call site for the same user inside an
-- hour is never a workload. Interactive chat carries its whole growing history in
-- the prompt, so a real conversation never repeats a hash; a background job stuck
-- on the same input repeats it immediately. The limit is therefore safe to make
-- strict, and the caller refuses rather than warns: a warning is what the
-- existing "SPEND NOT RECORDED" line already was, and it scrolled past for a week.
--
-- Deliberately NOT applied to embeddings. They average 452 tokens, and a user
-- searching the same term six times in an hour is ordinary use.

CREATE TABLE IF NOT EXISTS public.llm_call_fingerprints (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL,
  call_site text NOT NULL,
  prompt_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS llm_call_fingerprints_lookup_idx
  ON public.llm_call_fingerprints (user_id, call_site, prompt_hash, created_at DESC);

CREATE INDEX IF NOT EXISTS llm_call_fingerprints_sweep_idx
  ON public.llm_call_fingerprints (created_at);

ALTER TABLE public.llm_call_fingerprints ENABLE ROW LEVEL SECURITY;

-- No policy for anon/authenticated: this table is service-role only. It holds no
-- prompt text, only a hash, so there is nothing here for a client to read.
GRANT ALL ON public.llm_call_fingerprints TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.llm_call_fingerprints_id_seq TO service_role;

/**
 * Record this call and say whether it may proceed, in one statement so two
 * concurrent callers cannot both read "seen 4" and both proceed.
 *
 * Returns {allowed, seen, limit}. At or over the limit it records nothing and
 * refuses, so a blocked loop does not keep growing the table.
 */
CREATE OR REPLACE FUNCTION public.llm_note_call_fingerprint(
  _user_id uuid,
  _call_site text,
  _prompt_hash text,
  _window interval DEFAULT '1 hour',
  _limit integer DEFAULT 5
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_seen integer;
BEGIN
  -- Housekeeping, so this table never needs a cron of its own. Two hours is
  -- comfortably past the widest window a caller passes.
  DELETE FROM public.llm_call_fingerprints WHERE created_at < now() - interval '2 hours';

  SELECT count(*) INTO v_seen
    FROM public.llm_call_fingerprints
   WHERE user_id = _user_id
     AND call_site = _call_site
     AND prompt_hash = _prompt_hash
     AND created_at > now() - _window;

  IF v_seen >= _limit THEN
    RETURN jsonb_build_object('allowed', false, 'seen', v_seen, 'limit', _limit);
  END IF;

  INSERT INTO public.llm_call_fingerprints (user_id, call_site, prompt_hash)
  VALUES (_user_id, _call_site, _prompt_hash);

  RETURN jsonb_build_object('allowed', true, 'seen', v_seen + 1, 'limit', _limit);
END;
$function$;

REVOKE EXECUTE ON FUNCTION
  public.llm_note_call_fingerprint(uuid, text, text, interval, integer)
  FROM anon, authenticated;
