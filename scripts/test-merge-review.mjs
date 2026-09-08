import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { readFile, readdir } from 'node:fs/promises';
// A fresh disposable local database only; no application credentials are read.
const url = process.env.MERGE_TEST_DATABASE_URL;
if (url) {
 const target = new URL(url);
 if (!['localhost','127.0.0.1','[::1]'].includes(target.hostname) || target.pathname !== '/merge_review_test') throw Error('Local merge_review_test required');
}
const clients=[];
async function connect(){const c=new Client(url?{connectionString:url}:{host:'/var/run/postgresql',database:'merge_review_test',user:'postgres'});await c.connect();clients.push(c);return c;}
const u='76000000-0000-0000-0000-000000000001', foreign='76000000-0000-0000-0000-000000000002';
const source='77000000-0000-0000-0000-000000000001', target='77000000-0000-0000-0000-000000000002';
const tables=['contacts','profile_categories','profile_entries','action_items','contact_interactions','notes','contact_topics','contact_topic_events','contact_merge_receipts','contact_merge_vault_jobs','github_sync_log','contact_group_memberships','contact_relationships','relationship_rejections'];
const request=randomUUID();
try{
 const db=await connect(), a=await connect(), b=await connect();
 // Load the actual final profile normalization functions from migrations, with
 // their dependencies; fixtures must exercise the real silent-dedup trigger.
 const definitions=new Map();
 const migrationDir=new URL('../supabase/migrations/',import.meta.url);
 for(const file of (await readdir(migrationDir)).sort()){
  const sql=await readFile(new URL(file,migrationDir),'utf8');
  for(const match of sql.matchAll(/create\s+(?:or\s+replace\s+)?function\s+public\.((?:profile_|relationship_)\w+)\s*\([\s\S]*?\bas\s+(\$\w*\$)[\s\S]*?\2\s*;/gi)) definitions.set(match[1],match[0]);
 }
 const loaded=new Set();
 async function install(name){
  if(loaded.has(name))return;
  loaded.add(name);const sql=definitions.get(name);if(!sql)throw Error(`Missing real normalization function ${name}`);
  for(const match of sql.matchAll(/public\.((?:profile_|relationship_)\w+)\s*\(/g)) if(match[1]!==name) await install(match[1]);
  await db.query(sql);
 }
 await install('profile_entries_prevent_duplicate_fact');
 await install('relationship_dedup_guard');await install('relationship_rejection_guard');
 await db.query('drop trigger if exists trg_contact_relationships_dedup on contact_relationships; drop trigger if exists trg_relationship_rejection_guard on contact_relationships');
 await db.query('create trigger trg_contact_relationships_dedup before insert or update on contact_relationships for each row execute function relationship_dedup_guard(); create trigger trg_relationship_rejection_guard before insert or update on contact_relationships for each row execute function relationship_rejection_guard()');
 await db.query('drop trigger if exists trg_profile_entries_prevent_duplicate_fact on profile_entries');
 await db.query('create trigger trg_profile_entries_prevent_duplicate_fact before insert or update of user_id,contact_id,label,value on profile_entries for each row execute function profile_entries_prevent_duplicate_fact()');
 const role=async(c,id=u)=>{await c.query('set role authenticated');await c.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);};
 await role(a);await role(b);
 await db.query(`truncate ${tables.join(',')} cascade`);
 await db.query('insert into contacts(id,user_id,name,aliases) values($1,$3,\'Source\',ARRAY[\'Alias\']),($2,$3,\'Target\',ARRAY[]::text[])',[source,target,u]);
 await db.query(`insert into profile_categories(user_id,contact_id,slug,name) values($3,$1,'identity','Identity'),($3,$2,'identity','Identity'),($3,$1,'other','Other')`,[source,target,u]);
 await db.query(`insert into profile_entries(user_id,contact_id,category_id,label,value) select user_id,contact_id,id,'fact',case when slug='other' then 'unique other' else 'duplicate' end from profile_categories`);
 await db.query(`insert into profile_entries(user_id,contact_id,category_id,label,value) select user_id,contact_id,id,'unique','preserve content' from profile_categories where contact_id=$1 and slug='identity'`,[source]);
 await db.query('insert into action_items(user_id,contact_id,title) values($1,$2,\'action\');',[u,source]);
 await db.query('insert into contact_interactions(user_id,contact_id,summary) values($1,$2,\'interaction\')',[u,source]);
 await db.query(`insert into notes(user_id,metadata,is_trashed) select $1,jsonb_build_object('people',jsonb_build_array('Alias','Unrelated'),'matched_people',jsonb_build_array(jsonb_build_object('contact_id',$2::uuid,'detail','preserved'))),i%2=0 from generate_series(1,2501) i`,[u,source]);
 await db.query('insert into github_sync_log(user_id,entity_type,entity_id,sync_status) values($1,\'person\',$2,\'synced\')',[u,source]);
 await db.query('insert into contact_group_memberships(user_id,contact_id,group_id) values($1,$2,$3)',[u,source,randomUUID()]);
 await db.query("insert into contact_relationships(user_id,source_id,target_id,source_type,target_type,label) values($1,$2,$3,'contact','contact','friend')",[u,source,target]);
 const third=randomUUID();await db.query("insert into contacts(id,user_id,name) values($1,$2,'Third person')",[third,u]);
 await db.query("insert into contact_relationships(user_id,source_id,target_id,source_type,target_type,label) values($1,$2,$3,'contact','contact','Friend'),($1,$3,$4,'contact','contact','friend')",[u,source,third,target]);
 await db.query("insert into contact_relationships(user_id,source_id,target_id,source_type,target_type,label) values($1,$2,$3,'contact','contact','mother'),($1,$3,$4,'contact','contact','child')",[u,source,third,target]);
 const fourth=randomUUID();await db.query("insert into contacts(id,user_id,name) values($1,$2,'Fourth person')",[fourth,u]);
 await db.query("insert into contact_relationships(user_id,source_id,target_id,source_type,target_type,label,origin) values($1,$2,$3,'contact','contact','mentor','ai_extracted')",[u,source,fourth]);
 await db.query("insert into relationship_rejections(user_id,pair_key) select $1,relationship_pair_key($1,'contact',$2,'contact',$3,'mentor')",[u,target,fourth]);
 const command=async(c,id=randomUUID(),s=source,t=target,self=false)=>(await c.query('select merge_contacts_atomic($1,$2,$3,$4) result',[id,s,t,self])).rows[0].result;
 const topicCommand=async(c,title)=>c.query('select apply_contact_topic_command($1,$2)',[randomUUID(),{action:'create',contact_id:source,title}]);
 await topicCommand(a,'Initial topic');
 const snapshot=async()=>{
  const rows=[];
  for(const t of tables) rows.push((await db.query(`select to_jsonb(x) row from ${t} x order by ${t==='contact_merge_receipts'?'request_id':'id'}`)).rows);
  return JSON.stringify(rows);
 };
 const before=await snapshot();
 await assert.rejects(command(a,randomUUID(),source,source),e=>e.code==='22023');
 await role(b,foreign);await assert.rejects(command(b),e=>e.code==='PT409');await role(b);
 await db.query('set role anon');await assert.rejects(command(db),e=>e.code==='42501');await db.query('reset role');
 await assert.rejects(command(a,randomUUID(),source,null,true),e=>e.code==='PT409');
 assert.equal(await snapshot(),before);
 await db.query('drop function if exists merge_test_fail() cascade; drop sequence if exists merge_test_write_count');
 // Count each distinct table/write operation, then inject at every observed boundary.
 await db.query(`create sequence merge_test_write_count; create function merge_test_fail() returns trigger language plpgsql as $$declare n int; k text:=TG_TABLE_NAME||TG_OP; begin if current_setting('merge_test.enabled',true)='on' and position('|'||k||'|' in coalesce(current_setting('merge_test.seen',true),''))=0 then perform set_config('merge_test.seen',coalesce(current_setting('merge_test.seen',true),'')||'|'||k||'|',true); n:=nextval('public.merge_test_write_count'); if n::text=current_setting('merge_test.fail_at',true) then raise exception 'Injected merge write %',n; end if; end if; return null; end$$`);
 for(const t of tables) await db.query(`create trigger zz_merge_test_fail after insert or update or delete on ${t} for each statement execute function merge_test_fail()`);
 await db.query('grant usage,select on sequence merge_test_write_count to authenticated');
 await a.query('begin');await a.query("set local merge_test.enabled='on'");await command(a,request);const boundaries=Number((await db.query('select last_value from merge_test_write_count')).rows[0].last_value);await a.query('rollback');
 for(let i=1;i<=boundaries;i++){
  await db.query('alter sequence merge_test_write_count restart with 1');
  await a.query("select set_config('merge_test.enabled','on',false),set_config('merge_test.fail_at',$1,false)",[String(i)]);
  await assert.rejects(command(a,request),/Injected merge write/);
  assert.equal(await snapshot(),before,`write ${i} must roll back all rows`);
 }
 await a.query("set merge_test.enabled='off'");
 // A topic committed first is included; competing merges replay one receipt.
 await a.query('begin');await topicCommand(a,'Concurrent topic');
 const pending=command(b,request);await a.query('commit');await pending;
 const replay=await command(a,request);assert.equal(replay.replayed,true);
 await assert.rejects(command(a,request,source,null,true),e=>e.code==='22023');
 await assert.rejects(command(a,randomUUID(),target,source),e=>e.code==='PT409');
 await assert.rejects(topicCommand(a,'Late topic'),e=>e.code==='42501');
 assert.equal(Number((await db.query("select count(*) n from notes where metadata->'matched_people' @> jsonb_build_array(jsonb_build_object('contact_id',$1::uuid))",[source])).rows[0].n),0);
 assert.equal(Number((await db.query("select count(*) n from notes where metadata->'people' @> '[\"Target\"]'::jsonb")).rows[0].n),2501);
 assert.equal(Number((await db.query('select count(*) n from contact_topics where contact_id=$1',[target])).rows[0].n),2);
 assert.equal(Number((await db.query('select count(*) n from contact_merge_vault_jobs')).rows[0].n),1);
 assert.equal((await db.query('select source_snapshot from contact_merge_receipts')).rows[0].source_snapshot.entries.length,3);
 assert.equal(Number((await db.query('select count(*) n from contact_relationships where source_id=target_id')).rows[0].n),0);
 assert.equal(Number((await db.query('select count(*) n from contact_relationships')).rows[0].n),2);
 // Simultaneous retries serialize and return exactly one durable receipt.
 const s2=randomUUID(),t2=randomUUID();
 await db.query("insert into contacts(id,user_id,name) values($1,$3,'Retry source'),($2,$3,'Retry target')",[s2,t2,u]);
 const retryId=randomUUID();
 const retryResults=await Promise.all([a,b].map(c=>command(c,retryId,s2,t2)));
 assert.deepEqual(retryResults.map(r=>r.replayed).sort(),[false,true]);
 // Opposite merges on an unmerged pair must settle without a lock cycle.
 const s3=randomUUID(),t3=randomUUID();
 await db.query("insert into contacts(id,user_id,name) values($1,$3,'Reverse source'),($2,$3,'Reverse target')",[s3,t3,u]);
 const reverse=await Promise.allSettled([command(a,randomUUID(),s3,t3),command(b,randomUUID(),t3,s3)]);
 assert.equal(reverse.filter(r=>r.status==='fulfilled').length,1);
 assert.equal(reverse.find(r=>r.status==='rejected').reason.code,'PT409');
 // Merge owns the lifecycle lock first; a late topic waits, then refuses source.
 const s4=randomUUID(),t4=randomUUID();
 await db.query("insert into contacts(id,user_id,name) values($1,$3,'Race source'),($2,$3,'Race target')",[s4,t4,u]);
 await a.query('begin');await command(a,randomUUID(),s4,t4);
 const late=b.query('select apply_contact_topic_command($1,$2)',[randomUUID(),{action:'create',contact_id:s4,title:'Too late'}]).then(()=>null,e=>e);
 await a.query('commit');assert.equal((await late).code,'42501');
 // Clean self merge moves categories, actions and interactions without deleting history.
 const selfSource=randomUUID();await db.query('insert into contacts(id,user_id,name) values($1,$2,\'Self alias\')',[selfSource,u]);
 await db.query('insert into contact_interactions(user_id,contact_id,summary) values($1,$2,\'self history\')',[u,selfSource]);
 const selfBefore=await snapshot();
 await db.query('alter sequence merge_test_write_count restart with 1');
 await a.query('begin');await a.query("set local merge_test.enabled='on'; set local merge_test.fail_at=''");
 await command(a,randomUUID(),selfSource,null,true);
 const selfBoundaries=Number((await db.query('select last_value from merge_test_write_count')).rows[0].last_value);await a.query('rollback');
 for(let i=1;i<=selfBoundaries;i++){
  await db.query('alter sequence merge_test_write_count restart with 1');
  await a.query("select set_config('merge_test.enabled','on',false),set_config('merge_test.fail_at',$1,false)",[String(i)]);
  await assert.rejects(command(a,randomUUID(),selfSource,null,true),/Injected merge write/);
  assert.equal(await snapshot(),selfBefore,`self write ${i} must roll back all rows`);
 }
 await a.query("set merge_test.enabled='off'");
 await command(a,randomUUID(),selfSource,null,true);
 assert.equal((await db.query("select contact_id from contact_interactions where summary='self history'")).rows[0].contact_id,null);
 console.log(`PASS: ${boundaries} person + ${selfBoundaries} self injected write failures roll back all content; authenticated ownership, anonymous denial, self/topic rules, 2501 note refs, topic race, retry and reversal.`);
}finally{await Promise.all(clients.map(c=>c.end()));}









