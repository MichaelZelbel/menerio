
create table public.action_items (
  id uuid default gen_random_uuid() primary key,
  user_id uuid not null default auth.uid(),
  content text not null,
  source_note_id uuid references public.notes(id) on delete set null,
  contact_id uuid references public.contacts(id) on delete set null,
  status text not null default 'open',
  priority text not null default 'normal',
  due_date date,
  completed_at timestamptz,
  tags text[] default '{}',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.action_items enable row level security;

create policy "Users can manage own action items"
  on public.action_items for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create index idx_action_items_user_status on public.action_items (user_id, status);
create index idx_action_items_source on public.action_items (source_note_id);
create index idx_action_items_contact on public.action_items (contact_id);

create trigger handle_action_items_updated_at
  before update on public.action_items
  for each row
  execute function public.handle_updated_at();
