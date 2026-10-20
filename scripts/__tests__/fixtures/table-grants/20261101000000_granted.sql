-- A new table with explicit grants, a serial column with its sequence grant,
-- a deliberately private table, and a view.
create table if not exists public.reading_list (
  id bigserial primary key,
  user_id uuid not null,
  title text not null default 'untitled (grant on nothing)'
);
alter table public.reading_list enable row level security;
grant select, insert, update, delete on public.reading_list to authenticated;
grant select, insert, update, delete on public.reading_list to service_role;
grant usage, select on sequence public.reading_list_id_seq to authenticated;

create table private_leases (id uuid primary key generated always as identity);
revoke all on table public.private_leases from anon, authenticated;

create table if not exists public.reading_events (
  id bigint generated always as identity primary key
) partition by range (id);
create table public.reading_events_2026 partition of public.reading_events for values from (0) to (1000);
grant select on public.reading_events, public.reading_events_2026 to authenticated, service_role;

create or replace view public.reading_list_view with (security_invoker = on) as select id, title from public.reading_list;
grant select on public.reading_list_view to authenticated;

create temporary table scratch (x int);
create table auth_extras.not_public (x int);
