
create table public.dismissed_suggestions (
  id uuid default gen_random_uuid() primary key,
  user_id uuid not null,
  source_note_id uuid not null references public.notes(id) on delete cascade,
  target_note_id uuid not null references public.notes(id) on delete cascade,
  dismissed_at timestamptz default now(),
  unique(user_id, source_note_id, target_note_id)
);

create index idx_dismissed_user on public.dismissed_suggestions(user_id);

alter table public.dismissed_suggestions enable row level security;

create policy "Users can manage own dismissed suggestions"
  on public.dismissed_suggestions for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
