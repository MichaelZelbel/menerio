
create table public.contacts (
  id uuid default gen_random_uuid() primary key,
  user_id uuid not null default auth.uid(),
  name text not null,
  relationship text,
  company text,
  role text,
  email text,
  phone text,
  notes text,
  last_contact_date date,
  contact_frequency_days int,
  tags text[] default '{}',
  metadata jsonb default '{}',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table public.contact_interactions (
  id uuid default gen_random_uuid() primary key,
  contact_id uuid references public.contacts(id) on delete cascade not null,
  user_id uuid not null default auth.uid(),
  interaction_date date not null default current_date,
  type text not null,
  summary text,
  action_items text[] default '{}',
  note_id uuid references public.notes(id) on delete set null,
  created_at timestamptz default now()
);

alter table public.contacts enable row level security;
alter table public.contact_interactions enable row level security;

create policy "Users can manage own contacts"
  on public.contacts for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "Users can manage own interactions"
  on public.contact_interactions for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create index idx_contacts_user on public.contacts (user_id);
create index idx_contacts_name on public.contacts (user_id, name);
create index idx_interactions_contact on public.contact_interactions (contact_id);
create index idx_interactions_user on public.contact_interactions (user_id);

create trigger handle_contacts_updated_at
  before update on public.contacts
  for each row
  execute function public.handle_updated_at();
