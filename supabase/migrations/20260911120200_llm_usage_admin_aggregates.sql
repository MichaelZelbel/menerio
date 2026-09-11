-- Let the admin page ask the database for a total instead of downloading the
-- ledger and adding it up in the browser.
--
-- `Admin.tsx` fetched every `total_tokens` value over PostgREST and summed them in
-- JavaScript, and separately fetched every `model` value to build a dropdown of
-- the distinct ones. PostgREST caps a response at `max_rows`, which is 1000 on
-- this project. The table holds 20,295 rows. So the "total tokens used" stat card
-- was summing 1000 of 20,295 rows and reading low by roughly twenty times, and the
-- model filter only listed the models that happened to appear in an arbitrary
-- first page. Both were silently wrong, and both dragged the whole table over HTTP
-- to be wrong.
--
-- security_invoker on purpose: RLS on llm_usage_events then decides the scope. An
-- admin (`is_admin(auth.uid())`) gets the global figure, a normal user gets their
-- own. That is the right answer for both, so no separate admin-only view is needed.

CREATE OR REPLACE VIEW public.llm_usage_totals WITH (security_invoker = true) AS
SELECT count(*)::bigint AS events,
       COALESCE(sum(total_tokens), 0)::bigint AS total_tokens,
       COALESCE(sum(prompt_tokens), 0)::bigint AS prompt_tokens,
       COALESCE(sum(completion_tokens), 0)::bigint AS completion_tokens,
       COALESCE(sum(credits_charged), 0)::numeric AS credits_charged
FROM public.llm_usage_events;

COMMENT ON VIEW public.llm_usage_totals IS
  'One row of ledger totals, scoped by RLS (admin sees all, user sees own). Added 2026-09-11 so the admin overview stops summing a 1000-row page in the browser.';

CREATE OR REPLACE VIEW public.llm_usage_models WITH (security_invoker = true) AS
SELECT DISTINCT model
FROM public.llm_usage_events
WHERE model IS NOT NULL;

COMMENT ON VIEW public.llm_usage_models IS
  'The distinct models present in the ledger, scoped by RLS. 11 rows today against 20,295 events. Added 2026-09-11 so the admin model filter stops reading every row to find them.';

REVOKE ALL ON public.llm_usage_totals FROM public, anon;
REVOKE ALL ON public.llm_usage_models FROM public, anon;
GRANT SELECT ON public.llm_usage_totals TO authenticated, service_role;
GRANT SELECT ON public.llm_usage_models TO authenticated, service_role;
