
create table public.weekly_reviews (
  id uuid default gen_random_uuid() primary key,
  user_id uuid not null,
  week_start date not null,
  week_end date not null,
  review_data jsonb not null default '{}'::jsonb,
  created_at timestamptz default now()
);

alter table public.weekly_reviews enable row level security;

create policy "Users can view own reviews"
  on public.weekly_reviews for select
  to authenticated
  using (user_id = auth.uid());

create policy "Users can insert own reviews"
  on public.weekly_reviews for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "Users can delete own reviews"
  on public.weekly_reviews for delete
  to authenticated
  using (user_id = auth.uid());

create index idx_weekly_reviews_user_week on public.weekly_reviews (user_id, week_start desc);
