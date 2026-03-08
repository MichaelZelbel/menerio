
-- Enable pgvector extension
create extension if not exists vector with schema extensions;

-- Notes table
create table public.notes (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null default auth.uid(),
  title text not null default '',
  content text not null default '',
  embedding extensions.vector(1536),
  metadata jsonb default '{}'::jsonb,
  tags text[] default '{}'::text[],
  is_favorite boolean default false,
  is_pinned boolean default false,
  is_trashed boolean default false,
  trashed_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Indexes
create index notes_embedding_idx on public.notes using hnsw (embedding extensions.vector_cosine_ops);
create index notes_metadata_idx on public.notes using gin (metadata);
create index notes_tags_idx on public.notes using gin (tags);
create index notes_user_created_idx on public.notes (user_id, created_at desc);
create index notes_user_active_idx on public.notes (user_id, is_trashed, updated_at desc);

-- Auto-update updated_at trigger
create trigger notes_updated_at
  before update on public.notes
  for each row
  execute function public.handle_updated_at();

-- RLS
alter table public.notes enable row level security;

create policy "Users can view own notes"
  on public.notes for select
  to authenticated
  using (user_id = auth.uid());

create policy "Users can insert own notes"
  on public.notes for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "Users can update own notes"
  on public.notes for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "Users can delete own notes"
  on public.notes for delete
  to authenticated
  using (user_id = auth.uid());

-- Semantic search function
create or replace function public.match_notes(
  query_embedding extensions.vector(1536),
  match_threshold float default 0.7,
  match_count int default 10,
  p_user_id uuid default auth.uid()
)
returns table (
  id uuid,
  title text,
  content text,
  metadata jsonb,
  tags text[],
  similarity float,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  select
    n.id,
    n.title,
    n.content,
    n.metadata,
    n.tags,
    (1 - (n.embedding operator(extensions.<=>)  query_embedding))::float as similarity,
    n.created_at
  from public.notes n
  where n.user_id = p_user_id
    and n.is_trashed = false
    and (1 - (n.embedding operator(extensions.<=>) query_embedding))::float > match_threshold
  order by n.embedding operator(extensions.<=>) query_embedding
  limit match_count;
end;
$$;
