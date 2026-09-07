import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
const base=process.env.CONTACT_TOPICS_TEST_HTTP_URL;
if(!base || !/^http:\/\/(127\.0\.0\.1|localhost|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+):4175$/.test(base))throw new Error('Explicit local disposable HTTP adapter required');
const fixture=await fetch(base+'/fixture').then(r=>r.json());
const clients=[];
async function connect(key){const client=new Client({name:'topics-acceptance',version:'1'});await client.connect(new StreamableHTTPClientTransport(new URL(base+'/mcp'),{requestInit:{headers:{Authorization:`Bearer ${key}`}}}));clients.push(client);return client;}
function decode(r){assert.equal(r.isError,undefined,JSON.stringify(r));return JSON.parse(r.content[0].text);}
try{
 const a=await connect('mnr_topics_owner'), b=await connect('mnr_topics_other'), denied=await connect('mnr_topics_no_contacts');
 const advertised=await a.listTools();for(const name of ['create_contact_topic','undo_contact_topic_event'])assert(advertised.tools.some(t=>t.name===name));
 assert.equal((await denied.callTool({name:'list_contact_topics',arguments:{contact_id:fixture.person}})).isError,true);
 assert.equal((await b.callTool({name:'list_contact_topics',arguments:{contact_id:fixture.person}})).isError,true);
 const createSchema=advertised.tools.find(t=>t.name==='create_contact_topic').inputSchema;assert.deepEqual(createSchema.required.sort(),['contact_id','request_id','title']);assert.equal(createSchema.additionalProperties,false);
 const invalid=await a.callTool({name:'create_contact_topic',arguments:{contact_id:'Alex',title:'x',request_id:randomUUID()}});assert.equal(JSON.parse(invalid.content[0].text).error.code,'INVALID_INPUT');
 const title='Synthetic HTTP '+randomUUID(); const request_id=randomUUID();
 const args={contact_id:fixture.person,title,priority:'high',mode:'recurring',request_id};
 const created=decode(await a.callTool({name:'create_contact_topic',arguments:args}));
 const replay=decode(await a.callTool({name:'create_contact_topic',arguments:args}));assert.equal(replay.replayed,true);assert.equal(replay.event_id,created.event_id);
 const mismatch=await a.callTool({name:'create_contact_topic',arguments:{...args,title:title+' changed'}});assert.equal(JSON.parse(mismatch.content[0].text).error.code,'INVALID_COMMAND');
 const list=decode(await a.callTool({name:'list_contact_topics',arguments:{contact_id:fixture.person,query:title}}));assert.equal(list.topics[0].id,created.topic.id);
 const done=decode(await a.callTool({name:'discuss_contact_topic',arguments:{topic_id:created.topic.id,expected_version:1,request_id:randomUUID()}}));assert.equal(done.topic.status,'active');
 const closed=decode(await a.callTool({name:'discuss_contact_topic',arguments:{topic_id:created.topic.id,expected_version:2,close_after:true,request_id:randomUUID()}}));assert.equal(closed.topic.status,'completed');
 const history=decode(await a.callTool({name:'get_contact_topic_history',arguments:{topic_id:created.topic.id,limit:1}}));assert.equal(history.events.length,1);assert(history.next_cursor);
 const next=decode(await a.callTool({name:'get_contact_topic_history',arguments:{topic_id:created.topic.id,limit:1,cursor:history.next_cursor}}));assert.notEqual(next.events[0].id,history.events[0].id);
 const context=await a.callTool({name:'get_contact_context',arguments:{contact_id:fixture.person}});assert(context.content[0].text.includes('Topics to talk about'));
 const profile=await a.callTool({name:'get_contact_profile',arguments:{contact_id:fixture.person}});assert(profile.content[0].text.includes('Topics to talk about'));
 const alias=await a.callTool({name:'get_contact_context',arguments:{name:'craft FRIEND'}});assert(alias.content[0].text.includes('Synthetic Alex'));
 console.log('Actual MCP HTTP entrypoint: advertised tools, authentication/scopes, account isolation, structured validation, create/list, recurring/close/history pagination, retry conflict, both contexts and alias checks passed.');
}finally{await Promise.all(clients.map(c=>c.close()));}
