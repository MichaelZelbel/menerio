-- Installing this migration does NOT enable provider execution.
create table public.note_ai_worker_settings (
  id boolean primary key default true check (id),
  enabled boolean not null default false,
  -- Empty: no accounts; null: all accounts (requires explicit rollout approval).
  user_ids uuid[] default '{}'::uuid[],
  updated_at timestamptz not null default now()
);
alter table public.note_ai_worker_settings enable row level security;
revoke all on public.note_ai_worker_settings from public,anon,authenticated;
grant select on public.note_ai_worker_settings to service_role;
insert into public.note_ai_worker_settings(id,enabled,user_ids) values(true,false,'{}'::uuid[]);

-- Existing internal.call_edge supplies x-cron-key. Keep the timer inactive too.
do $$
declare job bigint;
begin
  job := cron.schedule('drain-note-ai-jobs','* * * * *',
    $command$select internal.call_edge('drain-note-ai-jobs', '{"cron":"drain-note-ai-jobs"}'::jsonb)$command$);
  perform cron.alter_job(job, active := false);
end $$;
