// Real PostgreSQL settings/grants test; cron API below is an explicit SQL fixture.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
const url = process.env.NOTE_AI_TEST_DATABASE_URL;
if (!url || process.env.NOTE_AI_TEST_ALLOW_DISPOSABLE !== '1') throw new Error('Explicit disposable database approval required');
const parsed = new URL(url);
if (!['localhost','127.0.0.1','[::1]'].includes(parsed.hostname) || !parsed.pathname.includes('disposable') || url.includes('tjeapelvjlmbxafsmjef')) throw new Error('Only a loopback disposable database is allowed');
const db = new pg.Client({ connectionString:url });
await db.connect();
try {
  await db.query('begin');
  await db.query(`create schema cron;
    create table cron.job(jobid bigint generated always as identity,jobname text,schedule text,command text,active boolean default true);
    create function cron.schedule(text,text,text) returns bigint language plpgsql as $$declare j bigint;begin insert into cron.job(jobname,schedule,command) values($1,$2,$3) returning jobid into j;return j;end$$;
    create function cron.alter_job(job_id bigint,active boolean) returns void language sql as $$update cron.job set active=$2 where jobid=$1$$;`);
  const migration = await readFile(new URL('../supabase/migrations/20260907130000_schedule_note_ai_jobs.sql',import.meta.url),'utf8');
  await db.query(migration);
  assert.deepEqual((await db.query('select enabled,user_ids from public.note_ai_worker_settings')).rows,[{enabled:false,user_ids:[]}]);
  const job = (await db.query('select jobname,schedule,command,active from cron.job')).rows[0];
  assert.equal(job.jobname,'drain-note-ai-jobs'); assert.equal(job.schedule,'* * * * *'); assert.equal(job.active,false);
  assert.match(job.command,/internal.call_edge/);
  const grants=(await db.query("select has_table_privilege('authenticated','public.note_ai_worker_settings','UPDATE') as may_update,has_table_privilege('service_role','public.note_ai_worker_settings','SELECT') as may_read")).rows[0];
  assert.equal(grants.may_update,false);assert.equal(grants.may_read,true);
  console.log('PASS: real PostgreSQL settings disabled, empty allowlist, service read, no user writes; SQL cron fixture records once-minute inactive schedule (not a live pg_cron execution)');
} finally { await db.query('rollback'); await db.end(); }
