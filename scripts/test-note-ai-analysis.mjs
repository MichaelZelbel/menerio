import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Client} from 'pg';
const url=process.env.NOTE_AI_ANALYSIS_TEST_DATABASE_URL;
if(!url || process.env.NOTE_AI_TEST_ALLOW_DISPOSABLE!=='1')throw Error('Explicit disposable analysis database required');
const target=new URL(url);
if(target.hostname!=='127.0.0.1'||target.pathname!=='/analysis_disposable'||url.includes('tjeapelvjlmbxafsmjef'))throw Error('Refusing non-disposable target');
const db=new Client({connectionString:url});await db.connect();
try {
 await db.query(`drop schema public cascade; create schema public; create schema if not exists extensions; create extension if not exists pgcrypto with schema extensions;
 create schema if not exists auth;
 create or replace function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create or replace function auth.role() returns text language sql as $$select coalesce(nullif(current_setting('request.jwt.claim.role',true),''),'service_role')$$;
 create table notes(id uuid primary key,user_id uuid not null,title text,content text,metadata jsonb default '{}',source_app text,is_external boolean default false,ai_visibility text default 'visible',created_at timestamptz default now(),is_trashed boolean default false,trashed_at timestamptz,embedding text,processing_status text,processing_error text,processed_at timestamptz,processed_hash text,processing_attempts integer default 0);
 create table media_analysis(id uuid primary key,user_id uuid,note_id uuid references notes(id),analysis_status text,description text,extracted_text text,topics text[]);
 create table note_chunks(id uuid default extensions.gen_random_uuid(),user_id uuid,note_id uuid,chunk_index integer,heading_path text,content text,token_count integer,embedding text,content_hash text);`);
 await db.query(await readFile(new URL('../supabase/migrations/20260907120000_note_ai_jobs.sql',import.meta.url),'utf8'));
 try {await db.query(await readFile(new URL('../supabase/migrations/20260907125000_note_ai_analysis_effects.sql',import.meta.url),'utf8'))}catch(error){if(error.code!=='ENOENT')throw error}
 const user='10000000-0000-0000-0000-000000000021',note='00000000-0000-0000-0000-000000000021';
 async function fresh(){await db.query('delete from notes where id=$1',[note]);await db.query(`insert into notes(id,user_id,title,content,metadata) values($1,$2,'Capture','Synthetic fixture content','{"is_quick_capture":true,"source":"fixture"}')`,[note,user]);await db.query("select enqueue_note_ai_job($1,$2,'analysis','manual')",[user,note]);return (await db.query('select * from claim_note_ai_jobs(1,300,$1)',[user])).rows[0]}
 const apply=(j,finish=true)=>db.query('select apply_note_ai_output($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7,$8) ok',[user,j.id,j.lease_id,JSON.stringify({topics:['fixture'],source:'stale source'}),'[0.1]','Generated fixture','legacy-hash',finish]);
 let j=await fresh();
 await db.query("update notes set title='User newer title' where id=$1",[note]);
 assert.equal((await apply(j)).rows[0].ok,false,'stale revision was applied');
 assert.equal((await db.query('select title from notes where id=$1',[note])).rows[0].title,'User newer title');
 j=await fresh();assert.equal((await apply(j,false)).rows[0].ok,true);
 let n=(await db.query('select * from notes where id=$1',[note])).rows[0];assert.equal(n.title,'Capture');assert.notEqual(n.processing_status,'processed');assert.equal(n.metadata.source,'fixture');
 assert.equal((await apply(j)).rows[0].ok,true);
 n=(await db.query('select * from notes where id=$1',[note])).rows[0];assert.equal(n.title,'Generated fixture');assert.equal(n.processing_status,'processed');
 const queued=(await db.query("select enqueue_note_ai_job($1,$2,'analysis','manual') j",[user,note])).rows[0].j;assert.equal(queued.state,'completed');assert.equal((await db.query('select * from claim_note_ai_jobs(1,300,$1)',[user])).rowCount,0,'generated title queued a second paid run');
 j=await fresh();await db.query('insert into note_chunks(user_id,note_id,content) values($1,$2,$3)',[user,note,'prior fixture']);
 const chunks=[{user_id:user,note_id:note,chunk_index:0,content:'new fixture',embedding:[0.2],token_count:3,content_hash:'fixture'}];
 assert.equal((await db.query('select replace_note_ai_chunks($1,$2,$3,$4::jsonb) ok',[user,j.id,j.lease_id,JSON.stringify(chunks)])).rows[0].ok,true);
 await db.query("update notes set content='Newer fixture' where id=$1",[note]);
 assert.equal((await db.query("select replace_note_ai_chunks($1,$2,$3,'[]') ok",[user,j.id,j.lease_id])).rows[0].ok,false);
 assert.equal((await db.query('select content from note_chunks where note_id=$1',[note])).rows[0].content,'new fixture');
 console.log('Analysis SQL passed: stale title fencing, pending status, source preservation, generated title no-repeat, atomic chunk fencing');
}finally{await db.end()}
