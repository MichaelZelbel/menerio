-- Notifications table
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  type text not null,
  title text not null,
  body text,
  link text,
  is_read boolean not null default false,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.notifications enable row level security;

create policy "Users can view own notifications"
  on public.notifications for select to authenticated
  using (user_id = auth.uid());

create policy "Users can update own notifications"
  on public.notifications for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "Users can delete own notifications"
  on public.notifications for delete to authenticated
  using (user_id = auth.uid());

create index idx_notifications_user_unread on public.notifications (user_id, is_read) where is_read = false;

-- Notification preferences table
create table public.notification_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique default auth.uid(),
  daily_digest_enabled boolean not null default false,
  digest_time text not null default 'morning',
  notify_stale_actions boolean not null default true,
  notify_contact_followup boolean not null default true,
  notify_patterns boolean not null default true,
  notify_weekly_review boolean not null default true,
  digest_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.notification_preferences enable row level security;

create policy "Users can manage own preferences"
  on public.notification_preferences for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create trigger handle_notification_prefs_updated_at
  before update on public.notification_preferences
  for each row execute function public.handle_updated_at();