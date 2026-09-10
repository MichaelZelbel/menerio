-- One query answers "what is eating tokens": per account, day and feature, with
-- the one number the 2026-09-10 audit had to derive by hand, the most times a
-- single note was bought in a day.
--
-- credits_ceil is what the ledger charged per event (CEIL(tokens/2000) each, so
-- 1,611 embedding calls read as 1,611 credits for 777k tokens). credits_exact is
-- what the allowance actually deducted. Use credits_exact for spend questions.
create or replace view public.llm_spend_daily with (security_invoker = true) as
with ev as (
  select user_id, (created_at at time zone 'UTC')::date as day, feature, note_id, total_tokens, credits_charged
  from public.llm_usage_events
),
per_note as (
  select user_id, day, feature, note_id, count(*) as runs
  from ev where note_id is not null
  group by 1, 2, 3, 4
)
select ev.user_id,
       ev.day,
       ev.feature,
       count(*)::bigint as calls,
       sum(ev.total_tokens)::bigint as tokens,
       sum(ev.credits_charged)::bigint as credits_ceil,
       round(sum(ev.total_tokens) / 2000.0, 1) as credits_exact,
       count(distinct ev.note_id)::bigint as notes,
       (select max(p.runs) from per_note p
         where p.user_id = ev.user_id and p.day = ev.day and p.feature = ev.feature)::bigint as max_runs_per_note
from ev
group by ev.user_id, ev.day, ev.feature;

comment on view public.llm_spend_daily is
  'Per account, day and feature: calls, tokens, ledger credits (ceil per event), exact credits (tokens/2000), distinct notes and the most runs one note got that day. Added 2026-09-11 after the checkbox-revision audit.';

revoke all on public.llm_spend_daily from public, anon;
grant select on public.llm_spend_daily to authenticated, service_role;
