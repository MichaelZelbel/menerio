import { Client } from 'pg';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
const url = process.env.NOTE_AI_TEST_DATABASE_URL;
if (!url || process.env.NOTE_AI_TEST_ALLOW_DISPOSABLE !== '1') throw new Error('Explicit disposable test connection required');
const target = new URL(url);
if (url.includes('tjeapelvjlmbxafsmjef') || !['localhost','127.0.0.1','[::1]'].includes(target.hostname) || !['/wiki_disposable','/note_ai_test'].includes(target.pathname)) throw new Error('Refusing non-local test database');
const db = new Client({ connectionString: url });
try {
 await db.connect(); await db.query('begin');
 // Synthetic schema fixture only. Never use this runner on application databases.
 await db.query(`
 create schema if not exists extensions;
 create extension if not exists pgcrypto with schema extensions;
 create schema if not exists auth;
 create or replace function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 create or replace function auth.role() returns text language sql as $$ select coalesce(nullif(current_setting('request.jwt.claim.role',true),''),'service_role') $$;
 create table if not exists notes(id uuid primary key,user_id uuid not null,title text default '',content text default '',metadata jsonb default '{}',source_app text,is_external boolean default false,ai_visibility text default 'visible',created_at timestamptz default now(),is_trashed boolean default false,trashed_at timestamptz);
 create table if not exists media_analysis(id uuid primary key,user_id uuid,note_id uuid references notes(id) on delete cascade,extracted_text text,description text,topics text[] default '{}',analysis_status text default 'pending');
 create table if not exists wiki_pages(id uuid primary key default gen_random_uuid(), user_id uuid not null,slug text not null,title text,content text,summary text,page_type text default 'concept',protected_sections text[] default '{}',updated_at timestamptz default now(),last_synthesized_at timestamptz,source_count integer default 0,unique(user_id,slug));
 create table if not exists wiki_revisions(id uuid primary key default gen_random_uuid(),user_id uuid,wiki_page_id uuid,page_slug text,page_title text,change_type text,previous_content text,new_content text,source_note_id uuid,change_summary text,status text);
 create table if not exists wiki_page_sources(user_id uuid,wiki_page_id uuid,note_id uuid,unique(wiki_page_id,note_id));
 create table if not exists wiki_links(user_id uuid,source_page_id uuid,target_slug text,target_page_id uuid);
 `);
 if (process.env.NOTE_AI_TEST_APPLY_QUEUE === '1') await db.query(await readFile(new URL('../supabase/migrations/20260907120000_note_ai_jobs.sql',import.meta.url),'utf8'));
 const migration = new URL('../supabase/migrations/20260907124000_wiki_note_ai_apply.sql',import.meta.url);
 if (existsSync(migration)) await db.query(await readFile(migration,'utf8'));
 await db.query('commit');
 await db.query('begin');
 await db.query(await readFile(new URL('../supabase/tests/wiki-ingest-jobs.sql',import.meta.url),'utf8'));
 await db.query('rollback');
 const a = new Client({connectionString:url}), b = new Client({connectionString:url});
 const owner='71000000-0000-4000-8000-000000000001', note='71000000-0000-4000-8000-000000000002';
 try {
  await a.connect(); await b.connect();
  await db.query('insert into notes(id,user_id,title,content) values($1,$2,$3,$4)',[note,owner,'Concurrent Lexicon fixture','Synthetic input']);
  await db.query("select enqueue_note_ai_job($1,$2,'lexicon','manual')",[owner,note]);
  const claim=async c=>(await c.query('select * from claim_note_ai_jobs(10,300,$1)',[owner])).rows.filter(j=>j.pipeline==='lexicon');
  const claims=await Promise.all([claim(a),claim(b)]);
  assert.equal(claims.flat().length,1,'two real concurrent claimants must claim one Lexicon job');
  const job=claims.flat()[0], scope=[owner,job.id,job.lease_id];
  await db.query("select begin_note_ai_stage($1,$2,$3,'wiki-apply')",scope);
  await db.query("select checkpoint_note_ai_stage($1,$2,$3,'wiki-apply',$4)",[...scope,{actions:[{op:'create',slug:'concurrent-fixture',title:'Fixture',content:'Synthetic fixture output',expected:null}],source_links:[]}]);
  const apply=c=>c.query('select wiki_apply_note_ai_result($1,$2,$3) ok',scope);
  const results=await Promise.all([apply(a),apply(b)]);
  assert.ok(results.every(r=>r.rows[0].ok));
  assert.equal((await db.query('select count(*)::int n from wiki_revisions where user_id=$1',[owner])).rows[0].n,1,'concurrent replay must produce exactly one revision');
  console.log('Lexicon real concurrent sessions: one claimant and one applied revision passed');
 } finally {
  await db.query('delete from wiki_links where user_id=$1',[owner]);
  await db.query('delete from wiki_page_sources where user_id=$1',[owner]);
  await db.query('delete from wiki_revisions where user_id=$1',[owner]);
  await db.query('delete from wiki_pages where user_id=$1',[owner]);
  await db.query('delete from notes where id=$1',[note]);
  await a.end(); await b.end();
 }
 console.log('Lexicon SQL: tenant, lease, expiry, revision conflict, replay, source rules passed');
} catch (error) {
 console.error('Lexicon SQL test failed:',error.code || error.name, String(error.message).replaceAll(url,'[redacted]')); process.exitCode=1;
} finally { await db.query('rollback').catch(()=>{}); await db.end(); }
