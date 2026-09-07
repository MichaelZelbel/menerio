// Disposable PostgreSQL + actual MCP entrypoint bridge for browser acceptance.
// This is a small PostgREST test adapter, not a production server or auth system.
import http from 'node:http';
import { createHash, webcrypto } from 'node:crypto';
globalThis.crypto ??= webcrypto;


import { Pool } from 'pg';
const connectionString = process.env.CONTACT_TOPICS_TEST_DATABASE_URL;
if (!connectionString || process.env.CONTACT_TOPICS_TEST_ALLOW_DISPOSABLE !== '1') throw new Error('Explicit disposable database required');
const target = new URL(connectionString);
if (!['localhost','127.0.0.1'].includes(target.hostname) || target.pathname !== '/contact_topics_test') throw new Error('Only local contact_topics_test permitted');
const pool = new Pool({ connectionString });
const port = Number(process.env.CONTACT_TOPICS_TEST_PORT ?? 4175);
const owner = '74000000-0000-4000-8000-000000000001', other = '74000000-0000-4000-8000-000000000002';
const person = '74000000-0000-4000-8000-000000000011', second = '74000000-0000-4000-8000-000000000012', foreign = '74000000-0000-4000-8000-000000000013';
await pool.query(`alter table public.contacts add column if not exists aliases text[] default '{}';
alter table public.contacts add column if not exists company text; alter table public.contacts add column if not exists relationship text;
create table if not exists public.hub_api_keys(id uuid primary key,user_id uuid,scopes text[],is_active boolean,expires_at timestamptz,key_hash text,last_used_at timestamptz);`);
await pool.query('alter role service_role bypassrls; grant select on public.contacts,public.hub_api_keys to service_role; grant update on public.hub_api_keys to service_role');
await pool.query('insert into public.contacts(id,user_id,name,aliases) values($1,$4,$6,$7),($2,$4,$8,$9),($3,$5,$10,$9) on conflict(id) do nothing',[person,second,foreign,owner,other,'Synthetic Alex',['Craft friend'],'Synthetic Robin',[],'Synthetic Other']);
for (const [i,key,user,scopes] of [[1,'mnr_topics_owner',owner,['contacts']],[2,'mnr_topics_other',other,['contacts']],[3,'mnr_topics_no_contacts',owner,['notes']]]) {
 await pool.query('insert into public.hub_api_keys(id,user_id,scopes,is_active,key_hash) values($1,$2,$3,true,$4) on conflict(id) do update set scopes=excluded.scopes', [`74000000-0000-4000-8000-00000000010${i}`,user,scopes,createHash('sha256').update(key).digest('hex')]);
}
let edgeFetch;
globalThis.Deno = { env: { get: key => ({ SUPABASE_URL: `http://127.0.0.1:${port}`, SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service', OPENROUTER_API_KEY: 'unused-synthetic' })[key] }, serve: fn => { edgeFetch = fn; } };
await import('../.superpowers/contact-topics/mcp.mjs');
const tables = new Set(['contacts','contact_topics','contact_topic_events','hub_api_keys']);
const identifier = value => { if (!/^[a-z_]+$/.test(value)) throw new Error('Invalid test query identifier'); return `"${value}"`; };
function splitParts(text) { const out=[]; let depth=0,start=0; for(let i=0;i<text.length;i++){if(text[i]==='(')depth++;if(text[i]===')')depth--;if(text[i]===','&&depth===0){out.push(text.slice(start,i));start=i+1;}}out.push(text.slice(start));return out; }
function condition(text, values) {
 if(text.startsWith('and(')||text.startsWith('or(')){const and=text.startsWith('and(');return '('+splitParts(text.slice(and?4:3,-1)).map(t=>condition(t,values)).join(and?' AND ':' OR ')+')';}
 const m=/^([a-z_]+)\.(eq|gt|lt|is|ilike)\.(.*)$/.exec(text); if(!m)throw new Error('Unsupported test query filter '+text);
 const col=identifier(m[1]); if(m[2]==='is'&&m[3]==='null')return col+' IS NULL';
 values.push(m[3]); return `${col} ${{eq:'=',gt:'>',lt:'<',ilike:'ILIKE',is:'='}[m[2]]} $${values.length}`;
}
const rpcArgs = {
 apply_contact_topic_command:['p_request_id','p_command'], apply_contact_topic_command_for_user:['p_user_id','p_request_id','p_command'],
 reassign_contact_topics:['p_source_contact_id','p_target_contact_id'], reassign_contact_topics_for_user:['p_user_id','p_source_contact_id','p_target_contact_id'],
 ai_can_see:['_user_id','_kind','_id'],
};
async function rest(req,url,body) {
 const client=await pool.connect(); const service=req.headers.authorization==='Bearer synthetic-service';
 const current=req.headers.authorization===`Bearer ${other}`?other:owner;
 try {
  await client.query('begin');
  if(service)await client.query('set local role service_role');
  if(!service){await client.query('set local role authenticated');await client.query("select set_config('request.jwt.claim.sub',$1,true)",[current]);}
  const path=url.pathname.replace('/rest/v1/','');
  if(path.startsWith('rpc/')) {
   const fn=path.slice(4), keys=rpcArgs[fn]; if(!keys)throw new Error('Unsupported test RPC '+fn);
   const result=await client.query(`select public.${identifier(fn)}(${keys.map((_,i)=>'$'+(i+1)).join(',')}) result`,keys.map(k=>body[k]));
   await client.query('commit');return {data:result.rows[0].result};
  }
  if(!tables.has(path)){await client.query('commit');return {data:[],count:0};}
  if(req.method==='PATCH'&&path==='hub_api_keys'){await client.query('commit');return {data:null};}
  if(req.method!=='GET'&&req.method!=='HEAD')throw new Error('Only feature RPC writes allowed');
  const values=[], filters=[];
  for(const [key,value] of url.searchParams){if(['select','order','limit','offset'].includes(key))continue;filters.push(key==='or'?condition('or'+value,values):condition(`${key}.${value}`,values));}
  const where=filters.length?' WHERE '+filters.join(' AND '):'';
  const count=Number((await client.query(`select count(*) n from public.${identifier(path)}${where}`,values)).rows[0].n);
  const fields=url.searchParams.get('select')??'*';
  const select=fields==='*'?'*':fields.split(',').map(identifier).join(',');
  const order=(url.searchParams.get('order')??'').split(',').filter(Boolean).map(s=>{const [col,dir]=s.split('.');return identifier(col)+(dir==='desc'?' DESC':' ASC');}).join(',');
  const limit=Math.max(0,Math.min(Number(url.searchParams.get('limit')??1000),1000)), offset=Math.max(0,Number(url.searchParams.get('offset')??0));
  const result=await client.query(`select ${select} from public.${identifier(path)}${where}${order?' ORDER BY '+order:''} LIMIT ${limit} OFFSET ${offset}`,values);
  await client.query('commit');return {data:req.headers.accept?.includes('vnd.pgrst.object')?result.rows[0]??null:result.rows,count};
 } catch(error){await client.query('rollback');return {error:{code:error.code??'TEST_ADAPTER_ERROR',message:error.message,details:error.detail},status:400};}
 finally{client.release();}
}
const server=http.createServer(async(req,res)=>{
 res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Access-Control-Allow-Headers','*');res.setHeader('Access-Control-Allow-Methods','GET,POST,HEAD,OPTIONS,PATCH');res.setHeader('Access-Control-Expose-Headers','Content-Range');
 if(req.method==='OPTIONS'){res.end();return;}
 try{
  const url=new URL(req.url,`http://127.0.0.1:${port}`); const chunks=[];for await(const chunk of req)chunks.push(chunk);const raw=Buffer.concat(chunks).toString();
  if(url.pathname==='/mcp'){
   const response=await edgeFetch(new Request(url,{method:req.method,headers:req.headers,...(raw?{body:raw}:{})}));res.writeHead(response.status,Object.fromEntries(response.headers));
   if(response.body){for await(const chunk of response.body)res.write(chunk);}res.end();return;
  }
  if(url.pathname==='/fixture'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({owner,other,person,second,foreign}));return;}
  if(url.pathname.startsWith('/rest/v1/')){
   const result=await rest(req,url,raw?JSON.parse(raw):{});res.statusCode=result.status??200;res.setHeader('Content-Type','application/json');if(result.count!==undefined)res.setHeader('Content-Range',`0-${Math.max(0,result.count-1)}/${result.count}`);res.end(req.method==='HEAD'?'':JSON.stringify(result.error??result.data));return;
  }
  res.setHeader('Content-Type','application/json');res.end('[]');
 }catch(error){res.statusCode=500;res.end(JSON.stringify({error:error.message}));}
});
server.listen(port,'0.0.0.0',()=>console.log(`Synthetic topic acceptance adapter ready on ${port}; actual MCP handler loaded`));
