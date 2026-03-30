
-- Note connections table
create table public.note_connections (
  id uuid default gen_random_uuid() primary key,
  user_id uuid not null,
  source_note_id uuid not null references public.notes(id) on delete cascade,
  target_note_id uuid not null references public.notes(id) on delete cascade,
  connection_type text not null,
  strength float default 1.0,
  metadata jsonb default '{}',
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(source_note_id, target_note_id, connection_type)
);

create index idx_connections_source on public.note_connections(source_note_id);
create index idx_connections_target on public.note_connections(target_note_id);
create index idx_connections_user on public.note_connections(user_id);
create index idx_connections_type on public.note_connections(connection_type);

alter table public.note_connections enable row level security;

create policy "Users can manage own connections"
  on public.note_connections for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create trigger handle_note_connections_updated_at
  before update on public.note_connections
  for each row execute function public.handle_updated_at();
