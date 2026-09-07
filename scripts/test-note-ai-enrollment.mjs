import { Client } from 'pg';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
const source = process.env.NOTE_AI_TEST_DATABASE_URL;
if (!source) throw new Error('Explicit local disposable connection required');
const target = new URL(source);
if (source.includes('tjeapelvjlmbxafsmjef') || !['127.0.0.1','localhost','[::1]'].includes(target.hostname) || !['/wiki_disposable','/enrollment_disposable'].includes(target.pathname)) throw new Error('Refusing non-local disposable connection');
target.pathname = '/enrollment_disposable';
const url = target.toString();
const adminTarget = new URL(url); adminTarget.pathname = '/postgres';
const admin = new Client({ connectionString: adminTarget.toString() });
await admin.connect();
if (!(await admin.query("select 1 from pg_database where datname='enrollment_disposable'")).rowCount) await admin.query('create database enrollment_disposable');
await admin.end();
const db = new Client({ connectionString: url });
try {
 await db.connect();
 const version = Number((await db.query('show server_version_num')).rows[0].server_version_num);
 assert.ok(version >= 170000 && version < 180000, 'PostgreSQL 17 required');
 // This runner exclusively owns this named disposable database, not any peer test database.
 await db.query('drop schema public cascade; create schema public; grant usage on schema public to authenticated,service_role');
 await db.query(`create schema if not exists extensions; create extension if not exists pgcrypto with schema extensions;
 create schema if not exists auth;
 create table if not exists auth.users(id uuid primary key);
 insert into auth.users(id) values('81000000-0000-4000-8000-000000000001'),('82000000-0000-4000-8000-000000000001') on conflict do nothing;
 create or replace function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 create or replace function auth.role() returns text language sql as $$ select nullif(current_setting('request.jwt.claim.role',true),'') $$;
 grant usage on schema auth to authenticated,service_role;
 -- Synthetic fixture matches locally inspected production column defaults/types used by capture.
 -- Vector indexes, auth.users FK and unrelated production triggers are not reproduced.
 create table notes(id uuid primary key default gen_random_uuid(),user_id uuid not null default auth.uid(),title text not null default '',content text not null default '',metadata jsonb default '{}',tags text[] default '{}',is_favorite boolean default false,is_pinned boolean default false,is_trashed boolean default false,trashed_at timestamptz,created_at timestamptz default now(),updated_at timestamptz default now(),entity_type text,related jsonb default '[]',source_app text,source_id text,source_url text,structured_fields jsonb default '{}',is_external boolean default false,sync_status text default 'synced',folder_path text not null default '',ai_visibility text not null default 'visible',processing_status text,processed_at timestamptz,processed_hash text,processing_error text,processing_attempts integer not null default 0);
 create table media_analysis(id uuid primary key default gen_random_uuid(),user_id uuid,note_id uuid references notes(id) on delete cascade,extracted_text text,description text,topics text[] default '{}',analysis_status text default 'pending');
 alter table notes enable row level security;
 create policy owner on notes to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
 grant select,insert,update,delete on notes to authenticated;
 `);
 await db.query(await readFile(new URL('../supabase/migrations/20260907120000_note_ai_jobs.sql',import.meta.url),'utf8'));
 const migration = new URL('../supabase/migrations/20260907131000_note_ai_capture_enrollment.sql',import.meta.url);
 try { await access(migration); await db.query(await readFile(migration,'utf8')); } catch(e) { if(e.code !== 'ENOENT') throw e; }
 await db.query(await readFile(new URL('../supabase/tests/note-ai-enrollment.sql',import.meta.url),'utf8'));
 const owner='81000000-0000-4000-8000-000000000001';
 const note='81000000-0000-4000-8000-000000000010';
 const a=new Client({connectionString:url}), b=new Client({connectionString:url});
 try {
  await Promise.all([a.connect(),b.connect()]);
  for (const c of [a,b]) await c.query(`set role authenticated; set request.jwt.claim.role='authenticated'; set request.jwt.claim.sub='${owner}'`);
  const capture=(c,content)=>c.query('select public.capture_note_with_lexicon($1::jsonb) note',[{id:note,user_id:owner,content}]);
  const results=await Promise.all([capture(a,'concurrent A'),capture(b,'concurrent B')]);
  assert.equal(results[0].rows[0].note.content,results[1].rows[0].note.content,'concurrent duplicate requests must return the same winning capture');
  assert.equal((await db.query("select count(*)::int n from note_ai_jobs where note_id=$1 and pipeline='lexicon'",[note])).rows[0].n,1);
  assert.equal((await db.query('select count(*)::int n from note_capture_receipts where note_id=$1',[note])).rows[0].n,1);
  // Simulate response loss: server committed, browser closes, another client edits.
  await a.end();
  await b.query("update notes set content='newer committed body' where id=$1",[note]);
  assert.equal((await capture(b,'concurrent A')).rows[0].note.content,'newer committed body');
  await b.query('delete from notes where id=$1',[note]);
  assert.equal((await capture(b,'concurrent A')).rows[0].note,null,'retry after deletion must acknowledge without resurrecting');
  assert.equal((await db.query('select count(*)::int n from notes where id=$1',[note])).rows[0].n,0);
  console.log('Real concurrent sessions: one capture/subscription; close, edit and hard-delete replay passed');
 } finally { await a.end().catch(()=>{}); await b.end(); }
 console.log('PostgreSQL 17 atomic capture enrollment assertions passed');
} catch (error) {
 console.error('Enrollment SQL failed:', error.code || error.name, String(error.message).replaceAll(source,'[redacted]').replaceAll(url,'[redacted]'));
 process.exitCode=1;
} finally { await db.end(); }
