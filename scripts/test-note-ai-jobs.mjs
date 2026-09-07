import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// No default connection. Never run against a real account database.
const url = process.env.NOTE_AI_TEST_DATABASE_URL;
if (!url || process.env.NOTE_AI_TEST_ALLOW_DISPOSABLE !== '1') {
  console.error('Require NOTE_AI_TEST_DATABASE_URL and NOTE_AI_TEST_ALLOW_DISPOSABLE=1. Disposable database only.');
  process.exit(2);
}
let target;
try { target = new URL(url); } catch { console.error('Invalid disposable database URL'); process.exit(2); }
if (url.includes('tjeapelvjlmbxafsmjef') || !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) || !['/note_ai_disposable', '/note_ai_test'].some(name => target.pathname === name)) {
  console.error('Refusing target: use local note_ai_disposable or note_ai_test only.');
  process.exit(2);
}
const { Client } = await import('pg');
const clients = [];
async function connect() {
  const client = new Client({ connectionString: url });
  await client.connect(); clients.push(client); return client;
}
try {
  const db = await connect();
  await db.query(`create schema if not exists extensions;
    create extension if not exists pgcrypto with schema extensions;
    create schema if not exists auth;
    do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
    do $$ begin create role service_role nologin; exception when duplicate_object then null; end $$;
    create or replace function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create or replace function auth.role() returns text language sql as $$ select coalesce(nullif(current_setting('request.jwt.claim.role',true),''),'service_role') $$;
    create table if not exists public.notes(id uuid primary key, user_id uuid not null, title text default '', content text default '', metadata jsonb default '{}', source_app text, is_external boolean default false, ai_visibility text default 'visible', created_at timestamptz default now(), is_trashed boolean default false, trashed_at timestamptz);
    create table if not exists public.media_analysis(id uuid primary key, user_id uuid not null, note_id uuid not null references public.notes(id) on delete cascade, storage_path text not null, media_type text not null, extracted_text text, description text, topics text[] default '{}', analysis_status text not null default 'pending');`);
  if (process.env.NOTE_AI_TEST_APPLY_MIGRATION === '1') {
    await db.query(await readFile(new URL('../supabase/migrations/20260907120000_note_ai_jobs.sql', import.meta.url), 'utf8'));
  }
  await db.query(await readFile(new URL('../supabase/tests/note-ai-jobs.sql', import.meta.url), 'utf8'));
  console.log('SQL queue assertions passed');
  const owner = '10000000-0000-0000-0000-000000000009';
  const note = '00000000-0000-0000-0000-000000000009';
  const a = await connect(), b = await connect();
  try {
    await db.query('delete from public.notes where id=$1', [note]);
    await db.query('insert into public.notes(id,user_id,title,content) values($1,$2,$3,$4)', [note, owner, 'Concurrency fixture', 'Synthetic local content']);
    const enqueues = await Promise.all([a,b].map(c => c.query("select public.enqueue_note_ai_job($1,$2,'analysis','manual') j", [owner,note])));
    assert.equal(enqueues[0].rows[0].j.id,enqueues[1].rows[0].j.id,'concurrent enqueue must coalesce');
    const claim = c => c.query('select * from public.claim_note_ai_jobs(1,300,$1)', [owner]);
    await a.query('begin');
    assert.equal((await claim(a)).rowCount,1);
    assert.equal((await claim(b)).rowCount,0,'SKIP LOCKED must exclude a claim held by an uncommitted transaction');
    await a.query('rollback');
    const results = await Promise.all([claim(a),claim(b)]);
    assert.equal(results[0].rowCount + results[1].rowCount, 1, 'concurrent workers must claim once');
    const job = results.find(r => r.rowCount).rows[0];
    const executions = await Promise.all([a,b].map(c => c.query('select public.claim_note_ai_execution($1,$2,$3) ok',[owner,job.id,job.lease_id])));
    assert.equal(executions.filter(r => r.rows[0].ok).length,1,'duplicate execution request accepted same lease');
    const stages = await Promise.all([a,b].map(c => c.query("select public.begin_note_ai_stage($1,$2,$3,'concurrent') r",[owner,job.id,job.lease_id])));
    assert.deepEqual(stages.map(r => r.rows[0].r.status).sort(),['busy','started'],'duplicate same-lease stage allowed paid call twice');
    assert.equal((await db.query('select public.finish_note_ai_job($1,$2,$3) ok',[owner,job.id,job.lease_id])).rows[0].ok,false,'unfinished paid stage marked pipeline complete');
    assert.equal((await db.query("select public.checkpoint_note_ai_stage($1,$2,$3,'concurrent','{}') ok",[owner,job.id,job.lease_id])).rows[0].ok,true);
    const snapshot = await db.query('select public.get_note_ai_job_snapshot($1,$2,$3) j', [owner,job.id,job.lease_id]);
    assert.equal(snapshot.rows[0].j.snapshot.content, 'Synthetic local content');
    await db.query("update public.notes set content='New synthetic revision' where id=$1", [note]);
    assert.equal((await db.query('select public.get_note_ai_job_snapshot($1,$2,$3) j', [owner,job.id,job.lease_id])).rows[0].j.snapshot.content, 'Synthetic local content', 'snapshot must remain captured');
    assert.equal((await db.query('select public.finish_note_ai_job($1,$2,$3) ok', [owner,job.id,'00000000-0000-0000-0000-000000000000'])).rows[0].ok, false);
    assert.equal((await db.query('select public.finish_note_ai_job($1,$2,$3) ok', ['10000000-0000-0000-0000-000000000008',job.id,job.lease_id])).rows[0].ok, false);
    assert.equal((await db.query('select public.finish_note_ai_job($1,$2,$3) ok', [owner,job.id,job.lease_id])).rows[0].ok, true);
    const pending = (await db.query('select * from public.note_ai_jobs where id=$1',[job.id])).rows[0];
    assert.equal(pending.state,'pending'); assert.ok(Number(pending.desired_generation)>Number(job.captured_generation));
    assert.equal(pending.snapshot,null);
    await db.query("select public.enqueue_note_ai_job($1,$2,'analysis','manual')",[owner,note]);
    const next = (await claim(a)).rows[0];
    assert.ok(next); assert.notEqual(next.lease_id,job.lease_id);
    assert.equal((await db.query('select public.finish_note_ai_job($1,$2,$3) ok',[owner,job.id,job.lease_id])).rows[0].ok,false);
    assert.equal((await db.query('select public.finish_note_ai_job($1,$2,$3) ok',[owner,next.id,next.lease_id])).rows[0].ok,true);
    assert.equal((await claim(b)).rowCount,0,'finished unchanged input never claimed again');
    console.log('Real concurrent sessions: exclusive claim, captured snapshot, tenant and stale-token fencing, no lost newer edit passed');
  } finally { await db.query('delete from public.notes where id=$1',[note]); }
} catch (error) {
  // PostgreSQL messages can include input values. Do not log connection or details.
  console.error('Queue database test failed:', error.code ?? error.name, error.message.replaceAll(url, '[redacted]'));
  process.exitCode = 1;
} finally {
  await Promise.all(clients.map(c => c.end()));
}
