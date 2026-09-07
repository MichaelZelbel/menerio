// Regenerate only this feature's schema entries, preserving the rest of the
// existing generated schema. Useful when the disposable DB has a minimal fixture.
import { readFile, writeFile } from 'node:fs/promises';
import { Client } from 'pg';
const url = process.env.CONTACT_TOPICS_TEST_DATABASE_URL;
if (!url) throw new Error('CONTACT_TOPICS_TEST_DATABASE_URL required');
const target = new URL(url);
if (!['localhost','127.0.0.1','[::1]'].includes(target.hostname) || target.pathname !== '/contact_topics_test') throw new Error('Local disposable schema required');
const db = new Client({ connectionString:url });
await db.connect();
try {
 const tsType = type => ({uuid:'string',text:'string',timestamptz:'string',int4:'number',bool:'boolean',jsonb:'Json'}[type] ?? (()=>{throw new Error(`Unsupported database type ${type}`)})());
 let tables = '';
 for (const table of ['contact_topics','contact_topic_events']) {
  const { rows: columns } = await db.query(`select a.attname name,t.typname type,a.attnotnull required,ad.oid is not null has_default from pg_attribute a join pg_type t on t.oid=a.atttypid left join pg_attrdef ad on ad.adrelid=a.attrelid and ad.adnum=a.attnum where a.attrelid=$1::regclass and a.attnum>0 and not a.attisdropped order by a.attname`,[`public.${table}`]);
  const { rows: relationships } = await db.query(`select c.conname name, c.confrelid::regclass::text target,
   array(select a.attname::text from unnest(c.conkey) with ordinality k(n,i) join pg_attribute a on a.attrelid=c.conrelid and a.attnum=k.n order by k.i) columns,
   array(select a.attname::text from unnest(c.confkey) with ordinality k(n,i) join pg_attribute a on a.attrelid=c.confrelid and a.attnum=k.n order by k.i) referenced
   from pg_constraint c where c.conrelid=$1::regclass and c.contype='f' order by c.conname`,[`public.${table}`]);
  tables+=`      ${table}: {\n`;
  for (const mode of ['Row','Insert','Update']) {
   tables+=`        ${mode}: {\n`;
   for (const c of columns) tables+=`          ${c.name}${mode==='Update'||mode==='Insert'&&(!c.required||c.has_default)?'?':''}: ${tsType(c.type)}${c.required?'':' | null'}\n`;
   tables+='        }\n';
  }
  tables+='        Relationships: [\n';
  for (const r of relationships) tables+=`          { foreignKeyName: ${JSON.stringify(r.name)}; columns: ${JSON.stringify(r.columns)}; isOneToOne: false; referencedRelation: ${JSON.stringify(r.target.replace('public.',''))}; referencedColumns: ${JSON.stringify(r.referenced)} },\n`;
  tables+='        ]\n      }\n';
 }
 let functions='';
 const names=['apply_contact_topic_command','apply_contact_topic_command_for_user','apply_contact_topic_command_internal','reassign_contact_topics','reassign_contact_topics_for_user'];
 const {rows:procs}=await db.query(`select p.proname name,p.proargnames names,array(select t.typname::text from unnest(p.proargtypes) with ordinality a(oid,i) join pg_type t on t.oid=a.oid order by a.i) types,t.typname returns from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_type t on t.oid=p.prorettype where n.nspname='public' and p.proname=any($1) order by p.proname`,[names]);
 for (const p of procs) functions+=`      ${p.name}: {\n        Args: { ${p.names.map((n,i)=>`${n}: ${tsType(p.types[i])}`).join('; ')} }\n        Returns: ${tsType(p.returns)}\n      }\n`;
 const path=new URL('../src/integrations/supabase/types.ts',import.meta.url);
 let content=(await readFile(path,'utf8')).replaceAll('\r\n','\n');
 for (const [kind,block] of [['TABLES',tables],['FUNCTIONS',functions]]) {
  const start=`      // BEGIN GENERATED CONTACT TOPIC ${kind}\n`,end=`      // END GENERATED CONTACT TOPIC ${kind}\n`;
  const first=content.indexOf(start),last=content.indexOf(end);
  if(first>=0)content=content.slice(0,first)+content.slice(last+end.length);
  const anchor=kind==='TABLES'?'    Tables: {\n':'    Functions: {\n';
  if(!content.includes(anchor))throw new Error(`Missing ${kind} anchor`);
  content=content.replace(anchor,anchor+start+block+end);
 }
 const {rows:[pending]}=await db.query("select t.typname type,a.attnotnull required from pg_attribute a join pg_type t on t.oid=a.atttypid where a.attrelid='public.contacts'::regclass and a.attname='topic_self_merge_pending'");
 if(pending){
  const start=content.indexOf('      contacts: {\n'),next=content.indexOf('\n      ',start+20);
  // Work inside the existing contacts block only, preserving all its other fields.
  const end=content.indexOf('\n      }\n',start)+9;
  let block=content.slice(start,end).replace(/^          topic_self_merge_pending\??: boolean\n/gm,'');
  for(const mode of ['Row','Insert','Update'])block=block.replace(`        ${mode}: {\n`,`        ${mode}: {\n          topic_self_merge_pending${mode==='Row'?'':'?'}: ${tsType(pending.type)}\n`);
  content=content.slice(0,start)+block+content.slice(end);
 }
 await writeFile(path,content);
 console.log('Regenerated contact topic tables and RPC declarations from local PostgreSQL catalog.');
} finally { await db.end(); }
