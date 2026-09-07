import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';

// Explicit disposable local target only. This script never loads application secrets.
const url = process.env.CONTACT_TOPICS_TEST_DATABASE_URL;
if (!url || process.env.CONTACT_TOPICS_TEST_ALLOW_DISPOSABLE !== '1') throw new Error('Set CONTACT_TOPICS_TEST_DATABASE_URL and CONTACT_TOPICS_TEST_ALLOW_DISPOSABLE=1');
const target = new URL(url);
if (!['localhost','127.0.0.1','[::1]'].includes(target.hostname) || target.pathname !== '/contact_topics_test') throw new Error('Only local contact_topics_test is permitted');
const clients = [];
async function connect() { const c = new Client({connectionString:url}); await c.connect(); clients.push(c); return c; }
const owner = '76000000-0000-0000-0000-000000000001';
const source = '77000000-0000-0000-0000-000000000001';
const destination = '77000000-0000-0000-0000-000000000002';
try {
 const db = await connect(), a = await connect(), b = await connect();
 const suite = await db.query(await readFile(new URL('../supabase/tests/contact_topics.sql',import.meta.url),'utf8'));
 const failures = suite.flatMap(r=>r.rows).flatMap(r=>Object.values(r)).filter(v=>typeof v==='string' && /^not ok|^# (Failed|Looks like)/m.test(v));
 assert.deepEqual(failures,[], 'SQL assertion failures');
 await db.query('insert into public.contacts(id,user_id,name) values($1,$3,$4),($2,$3,$5)',[source,destination,owner,'Synthetic race source','Synthetic race target']);
 const command = async(c,request,payload) => (await c.query('select public.apply_contact_topic_command_for_user($1,$2,$3) result',[owner,request,payload])).rows[0].result;
 const create = {action:'create',contact_id:source,title:'Synthetic concurrency',mode:'recurring'};
 const request = randomUUID();
 const retries = await Promise.all([a,b].map(c=>command(c,request,create)));
 assert.equal(retries[0].topic.id,retries[1].topic.id);
 assert.deepEqual(retries.map(r=>r.replayed).sort(),[false,true]);
 assert.equal((await db.query('select count(*)::integer n from public.contact_topic_events where user_id=$1 and request_id=$2',[owner,request])).rows[0].n,1);
 const topic = retries[0].topic;
 const edits = await Promise.allSettled([a,b].map((c,i)=>command(c,randomUUID(),{action:'update',topic_id:topic.id,expected_version:1,patch:{title:`Synthetic edit ${i}`}})));
 assert.equal(edits.filter(r=>r.status==='fulfilled').length,1);
 assert.equal(edits.find(r=>r.status==='rejected').reason.code,'PT409');
 // Throw at the event insertion boundary, after the row update was attempted.
 await db.query(`create function public.contact_topics_test_fail() returns trigger language plpgsql as $$begin if new.user_id='${owner}' then raise exception 'Synthetic insert failure'; end if; return new; end$$;
 create trigger contact_topics_test_fail before insert on public.contact_topic_events for each row execute function public.contact_topics_test_fail()`);
 try { await assert.rejects(command(a,randomUUID(),{action:'archive',topic_id:topic.id,expected_version:2}),/Synthetic insert failure/); }
 finally { await db.query('drop trigger contact_topics_test_fail on public.contact_topic_events; drop function public.contact_topics_test_fail()'); }
 assert.deepEqual((await db.query('select version,status from public.contact_topics where id=$1',[topic.id])).rows[0],{version:2,status:'active'});
 // Pause exactly between lifecycle/owner locks and the service contact lock.
 // Merge must wait at its statement gate before acquiring the source tuple.
 await a.query('begin'); await b.query('begin');
 await a.query("select pg_advisory_xact_lock_shared(hashtextextended('contact-topics-lifecycle',0)),pg_advisory_xact_lock(hashtextextended('contact-topics:'||$1::text,0))",[owner]);
 const waitingMerge = b.query('update public.contacts set merged_into=$1 where id=$2',[destination,source]);
 await new Promise(resolve=>setTimeout(resolve,100));
 await command(a,randomUUID(),{...create,title:'Synthetic lock-order interleaving'});
 await a.query('commit'); await waitingMerge; await b.query('rollback');
 // Create acquires the owner lock first; merge waits then transfers the committed row.
 await a.query('begin');
 const racing = await command(a,randomUUID(),{...create,title:'Synthetic create before merge'});
 const merge = b.query('update public.contacts set merged_into=$1 where id=$2',[destination,source]);
 await a.query('commit'); await merge;
 assert.equal((await db.query('select contact_id from public.contact_topics where id=$1',[racing.topic.id])).rows[0].contact_id,destination);
 await assert.rejects(command(a,randomUUID(),create),e=>e.code==='42501');
 // A merge failure rolls back both transfer and marker.
 await db.query('begin');
 await db.query('update public.contacts set merged_into=null where id=$1',[source]);
 await db.query('select public.reassign_contact_topics_for_user($1,$2,$3)',[owner,destination,source]);
 await db.query('commit');
 await a.query('begin');
 await a.query('update public.contacts set merged_into=$1 where id=$2',[destination,source]);
 await a.query('rollback');
 assert.equal((await db.query('select contact_id from public.contact_topics where id=$1',[racing.topic.id])).rows[0].contact_id,source);
 // Merge acquires the owner lock first; create waits and then refuses the merged person.
 await a.query('begin');
 await a.query('update public.contacts set merged_into=$1 where id=$2',[destination,source]);
 const lateCreate = command(b,randomUUID(),create).then(()=>null,e=>e);
 await a.query('commit');
 assert.equal((await lateCreate).code,'42501');
 // Retry must honor visibility of the current destination, not its old receipt.
 await db.query("update public.contacts set ai_visibility='hidden' where id=$1",[destination]);
 await assert.rejects(command(a,request,create),e=>e.code==='42501');
 await db.query("update public.contacts set ai_visibility='visible',is_sensitive=true where id=$1",[destination]);
 await assert.rejects(command(a,request,create),e=>e.code==='42501');
 console.log('SQL assertions plus real concurrent replay, stale edits, injected rollback, both merge/create orders, failed merge and service visibility tests passed.');
} finally {
 for (const c of clients) await c.query('rollback').catch(()=>{});
 if (clients[0]) await clients[0].query('delete from public.contacts where user_id=$1',[owner]);
 await Promise.all(clients.map(c=>c.end()));
}
