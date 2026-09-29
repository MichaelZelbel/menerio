-- Mission Control's World mirror reads what assistants may see, filtered in the
-- database (review of 2026-09-29; docs/plans/one-fact-store.md, section 8,
-- eleventh review "Not fixed").
--
-- world_claims is agent_facts plus every relationship. mc-api-world kept the
-- relationships from or to a hidden or sensitive person out of the mirror by
-- writing every such person's id into the request URL, twice. With a few
-- hundred of them the URL is too long and the whole World endpoint answers
-- 500; and the list of them was one unpaged read, so past the server's 1,000
-- rows the rest were silently missing from the filter and their relationships
-- went out to a git repository.
--
-- agent_world_claims is world_claims with that rule applied here, the rule
-- agent_facts applies to facts: a relationship end that is a person must be
-- one of this user's people, not merged away, visible and not sensitive. The
-- claim arm is agent_facts already. Read by mc-api-world with the service role
-- only, so no client role gets it.
--
-- Also: world_claims was granted to anon. No row ever reached anon (its claim
-- arm reads agent_facts, which anon may not read), but nothing needs the grant.
--
-- Apply BEFORE deploying mc-api-world: the new function reads this view, and
-- until it exists the World endpoint answers 500 (it fails closed, nothing leaks).
--
-- Idempotent. No BEGIN/COMMIT in the file: the runner wraps it in one
-- transaction, and the last block raises (undoing everything) if a grant is wrong.

CREATE OR REPLACE VIEW public.agent_world_claims WITH (security_invoker = on) AS
SELECT w.*
  FROM public.world_claims w
 WHERE w.source_table = 'claim'
    OR ((w.subject_id IS NULL OR EXISTS (
           SELECT 1 FROM public.contacts ct
            WHERE ct.id = w.subject_id AND ct.user_id = w.user_id AND ct.merged_into IS NULL
              AND ct.is_sensitive IS NOT TRUE AND ct.ai_visibility = 'visible'))
        AND (w.object_id IS NULL OR EXISTS (
           SELECT 1 FROM public.contacts ct
            WHERE ct.id = w.object_id AND ct.user_id = w.user_id AND ct.merged_into IS NULL
              AND ct.is_sensitive IS NOT TRUE AND ct.ai_visibility = 'visible')));

COMMENT ON VIEW public.agent_world_claims IS
  'world_claims as it may leave the owner''s view: agent_facts plus the relationships whose people assistants may see. Service role only (mc-api-world).';

REVOKE ALL ON public.agent_world_claims FROM public, anon, authenticated;
GRANT SELECT ON public.agent_world_claims TO service_role;

REVOKE ALL ON public.world_claims FROM anon;

DO $$
BEGIN
  IF has_table_privilege('anon', 'public.agent_world_claims', 'SELECT')
     OR has_table_privilege('authenticated', 'public.agent_world_claims', 'SELECT')
     OR has_table_privilege('anon', 'public.world_claims', 'SELECT') THEN
    RAISE EXCEPTION 'agent_world_claims or world_claims is still readable by a client role';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.agent_world_claims', 'SELECT') THEN
    RAISE EXCEPTION 'service_role cannot read agent_world_claims';
  END IF;
END $$;
