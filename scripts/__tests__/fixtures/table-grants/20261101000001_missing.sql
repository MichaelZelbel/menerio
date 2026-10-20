-- create table public.commented_out (x int);  is a comment, not a table.
create table if not exists public.forgotten (
  id uuid primary key default gen_random_uuid()
);
grant execute on function public.forgotten_helper() to authenticated;

create table public.counters (
  id serial primary key,
  n int
);
grant select, insert on public.counters to authenticated;

create materialized view public.forgotten_stats as select count(*) from public.forgotten;
