import { describe,it,expect } from 'vitest';
import { handleNoteAIRequest, changedProfileSubjects } from '../note-ai-processing';
it('normalizes only confirmed saved profile writes, not extracted or pending facts',()=>{
 expect(changedProfileSubjects([
  {suggestion_type:'add_profile_entry',status:'pending_review',payload:{contact_id:'pending'}},
  {suggestion_type:'add_profile_entry',status:'removed',payload:{contact_id:'duplicate'}},
  {suggestion_type:'add_profile_entry',status:'auto_applied_unreviewed',target_entity_id:'entry',payload:{contact_id:'saved'}},
  {suggestion_type:'add_profile_entry',status:'auto_applied_unreviewed',target_entity_id:'owner-entry',payload:{contact_id:null}},
  {suggestion_type:'add_relationship',status:'auto_applied_unreviewed',target_entity_id:'rel',payload:{contact_id:'other'}},
 ])).toEqual(['saved',null]);
});
import { loadProcessor } from './note-ai-processing-harness';
import {createNoteAIJobs,NoteAIJobError,classifyNoteAIError} from '../note-ai-jobs';
it('real processor reports unavailable allowance as transient and holds captured lease',async()=>{
 const failures:string[]=[];let paid=0;
 const lease={id:'j',user_id:'u',note_id:'n',lease_id:'l',pipeline:'analysis',desired_generation:1,captured_generation:1,fingerprint:'f',snapshot:{id:'n',user_id:'u',title:'Fixture title',content:'Fixture content text',media:[]}};
 const db={rpc:async(name:string,args:any)=>{if(name==='fail_note_ai_job')failures.push(args._kind);return {data:name==='get_note_ai_job_snapshot'?lease:true,error:null}},from:()=>{const q:any=new Proxy({}, {get:(_,key)=>key==='then'?(resolve:any)=>Promise.resolve({data:lease.snapshot,error:null}).then(resolve):()=>q});return q;}};
 const processor=loadProcessor({Deno:{env:{get:()=>''},serve:()=>{}},createClient:()=>db,createNoteAIJobs,NoteAIJobError,classifyNoteAIError,handleNoteAIRequest,checkBalance:async()=>({allowed:false,unavailable:true}),noteContentHash:()=> 'h',runChat:async()=>{paid++;return {}},console:{log:()=>{},warn:()=>{},error:()=>{}}});
 await expect(processor.processInBackground(lease,'Bearer service')).rejects.toThrow();
 expect(failures).toEqual(['transient']);expect(paid).toBe(0);
});
it('real processor reuses checkpointed metadata after embedding fails and finishes after derivatives',async()=>{
 const events:string[]=[];let paid=0;let embeds=0;const stages=new Map<string,any>();
 const lease={id:'j',user_id:'u',note_id:'n',lease_id:'l',pipeline:'analysis',desired_generation:1,captured_generation:1,fingerprint:'f',snapshot:{id:'n',user_id:'u',title:'Fixture title',content:'Fixture content text',media:[{description:'attachment fixture',topics:[]}]}};
 const db={rpc:async(name:string,args:any)=>{
  if(name==='apply_note_ai_output')events.push(args._finish?'finished-output':'pending-output');
  events.push(name);
  if(name==='begin_note_ai_stage')return {data:stages.get(args._stage)??{status:'started'},error:null};
  if(name==='checkpoint_note_ai_stage')stages.set(args._stage,{status:'checkpointed',result:args._result});
  if(name==='apply_note_ai_stage')stages.set(args._stage,{status:'applied',result:stages.get(args._stage)?.result});
  return {data:name==='get_note_ai_job_snapshot'?lease:true,error:null};
 },from:()=>{const q:any=new Proxy({}, {get:(_,key)=>key==='then'?(resolve:any)=>Promise.resolve({data:[],error:null}).then(resolve):()=>q});return q;}};
 const processor=loadProcessor({Deno:{env:{get:()=>''},serve:()=>{}},createClient:()=>db,createNoteAIJobs,NoteAIJobError,classifyNoteAIError,handleNoteAIRequest,checkBalance:async()=>({allowed:true}),noteContentHash:()=> 'h',runChat:async(options:any)=>{paid++;expect(options).toMatchObject({jobId:'j',revision:'f',stage:'metadata'});expect(options.messages[0].content).toContain('attachment fixture');return {content:'{"topics":[]}' }},parseModelJson:JSON.parse,PROCESS_NOTE_METADATA_PROMPT:'fixture',metadataFieldContract:()=>'',sourceLanguageRule:()=>'',shouldExtractFacts:()=>true,embedAndStoreNoteChunks:async()=>{if(++embeds===1)throw Error('embedding fixture failure');return {firstChunkEmbedding:[1],chunkCount:1,failures:0}},fetch:async()=>{await new Promise(r=>setTimeout(r,5));events.push('downstream-complete');return {ok:true}},events,console:{log:()=>{},warn:()=>{},error:()=>{}}},'loadSelfContext=async()=>({enabled:false,aliases:new Set()});generateReviewItems=async()=>{events.push("review")};generateProfileSuggestions=async()=>{events.push("profile")};generateMomentSuggestions=async()=>{events.push("moment")};');
 await expect(processor.processInBackground(lease,'Bearer service')).rejects.toThrow('embedding fixture failure');
 await processor.processInBackground(lease,'Bearer service');
 expect(paid).toBe(1);expect(events.indexOf('finished-output')).toBeGreaterThan(events.indexOf('moment'));expect(events.indexOf('pending-output')).toBeGreaterThan(-1);
 expect(events.filter(e=>e==='downstream-complete')).toHaveLength(2);
 expect(events.lastIndexOf('downstream-complete')).toBeLessThan(events.indexOf('finished-output'));
 events.length=0;
 db.from=()=>{const q:any=new Proxy({}, {get:(_,key)=>key==='then'?(resolve:any)=>Promise.resolve({data:null,error:{code:'XX001'}}).then(resolve):()=>q});return q};
 await expect(processor.processInBackground(lease,'Bearer service')).rejects.toMatchObject({kind:'transient'});
 expect(events).not.toContain('finished-output');
});
it.each(['profile','moment'])('real %s extractor reuses paid output and rejects malformed paid output',async(kind)=>{
 let paid=0;let raw=kind==='profile'?'{"facts":[],"relationships":[]}':'{"is_event":false}';const stages=new Map<string,any>();
 const lease={id:'j',user_id:'u',note_id:'n',lease_id:'l',pipeline:'analysis',desired_generation:1,captured_generation:1,fingerprint:'f',snapshot:{}};
 const db={rpc:async(name:string,args:any)=>{if(name==='begin_note_ai_stage')return {data:stages.get(args._stage)??{status:'started'},error:null};if(name==='checkpoint_note_ai_stage')stages.set(args._stage,{status:'checkpointed',result:args._result});return {data:name==='get_note_ai_job_snapshot'?lease:true,error:null}}};
 const processor=loadProcessor({Deno:{env:{get:()=>''},serve:()=>{}},createClient:()=>db,createNoteAIJobs,NoteAIJobError,classifyNoteAIError,handleNoteAIRequest,checkBalance:async()=>({allowed:true}),runChat:async()=>{paid++;return {content:raw}},parseModelJson:(s:string)=>{try{return JSON.parse(s)}catch{return null}},loadProfileFields:async()=>[],ProfileFieldsRegistry:class{},profileExtractionContract:()=>'',outputLanguageRule:()=>'',PROCESS_NOTE_PROFILE_PROMPT:'fixture',PROCESS_NOTE_MOMENT_PROMPT:'fixture',console:{log:()=>{},warn:()=>{},error:()=>{}}},'getSuggestionPreferences=async()=>({mode:"review",profileLanguage:"en"});');
 const people=[{name:'Fixture',canonical_name:'Fixture',is_self:true}];
 const run=()=>kind==='profile'?processor.generateProfileSuggestions('u','n','Fixture','Fixture content',people,{},lease):processor.generateMomentSuggestions('u','n','Fixture','Fixture content',people,{dates_mentioned:['2026-01-01']},lease);
 await run();await run();expect(paid).toBe(1);
 stages.clear();raw='invalid fixture output';await expect(run()).rejects.toMatchObject({kind:'permanent'});
});
it.each(['profile','moment'])('real %s extractor refuses credit and database failures without false completion',async(kind)=>{
 const lease={id:'j',user_id:'u',note_id:'n',lease_id:'l',pipeline:'analysis',desired_generation:1,captured_generation:1,fingerprint:'f',snapshot:{}};let unavailable=true;let paid=0;
 const db={rpc:async()=>({data:lease,error:null})};
 const processor=loadProcessor({Deno:{env:{get:()=>''},serve:()=>{}},createClient:()=>db,createNoteAIJobs,NoteAIJobError,classifyNoteAIError,handleNoteAIRequest,checkBalance:async()=>({allowed:false,unavailable}),runChat:async()=>{paid++},console:{log:()=>{},warn:()=>{},error:()=>{}}},'getSuggestionPreferences=async()=>({mode:"review"});');
 const people=[{name:'Fixture',canonical_name:'Fixture',is_self:true}];const run=()=>kind==='profile'?processor.generateProfileSuggestions('u','n','Fixture','Fixture content',people,{},lease):processor.generateMomentSuggestions('u','n','Fixture','Fixture content',people,{dates_mentioned:['2026-01-01']},lease);
 await expect(run()).rejects.toMatchObject({kind:'transient'});unavailable=false;await expect(run()).rejects.toMatchObject({kind:'no_credit'});expect(paid).toBe(0);
});
it('does not finish when credits run out inside metadata production',async()=>{
 const lease={id:'j',user_id:'u',note_id:'n',lease_id:'l',pipeline:'analysis',desired_generation:1,captured_generation:1,fingerprint:'f',snapshot:{id:'n',user_id:'u',title:'Fixture',content:'Fixture content text',media:[]}};const kinds:string[]=[];
 const db={rpc:async(name:string,args:any)=>{if(name==='fail_note_ai_job')kinds.push(args._kind);return {data:name==='get_note_ai_job_snapshot'?lease:name==='begin_note_ai_stage'?{status:'started'}:true,error:null}},from:()=>{const q:any=new Proxy({}, {get:(_,key)=>key==='then'?(resolve:any)=>Promise.resolve({data:[],error:null}).then(resolve):()=>q});return q}};
 const processor=loadProcessor({Deno:{env:{get:()=>''},serve:()=>{}},createClient:()=>db,createNoteAIJobs,NoteAIJobError,classifyNoteAIError,handleNoteAIRequest,checkBalance:async()=>({allowed:true}),noteContentHash:()=> 'h',runChat:async()=>{throw Error('INSUFFICIENT_CREDITS')},PROCESS_NOTE_METADATA_PROMPT:'fixture',metadataFieldContract:()=>'',sourceLanguageRule:()=>'',console:{log:()=>{},warn:()=>{},error:()=>{}}});
 await expect(processor.processInBackground(lease,'Bearer service')).rejects.toThrow('INSUFFICIENT_CREDITS');expect(kinds).toEqual(['no_credit']);
});
it('checkpoints the paid fiction guard instead of recharging it on downstream retries',async()=>{
 let paid=0;let saved:any;const lease={id:'j',user_id:'u',note_id:'n',lease_id:'l',pipeline:'analysis',desired_generation:1,captured_generation:1,fingerprint:'f',snapshot:{}};
 const db={rpc:async(name:string,args:any)=>{if(name==='checkpoint_note_ai_stage')saved={status:'checkpointed',result:args._result};return {data:name==='get_note_ai_job_snapshot'?lease:name==='begin_note_ai_stage'?(saved??{status:'started'}):true,error:null}}};
 const processor=loadProcessor({Deno:{env:{get:()=>''},serve:()=>{}},createClient:()=>db,createNoteAIJobs,NoteAIJobError,classifyNoteAIError,handleNoteAIRequest,parseModelJson:JSON.parse,runChat:async()=>{paid++;return {content:'{"verdicts":[{"name":"Fixture","verdict":"real_person"}]}'}}});
 await processor.verifyRealPeopleWithLLM('u','Fixture','Fixture content',['Fixture'],'n',lease);await processor.verifyRealPeopleWithLLM('u','Fixture','Fixture content',['Fixture'],'n',lease);expect(paid).toBe(1);
});
it('finishes an empty captured note without a balance or provider call',async()=>{
 let balanceCalls=0;const lease={id:'j',user_id:'u',note_id:'n',lease_id:'l',pipeline:'analysis',desired_generation:1,captured_generation:1,fingerprint:'f',snapshot:{id:'n',user_id:'u',title:'',content:'',media:[]}};
 const db={rpc:async(name:string)=>({data:name==='get_note_ai_job_snapshot'?lease:true,error:null})};
 const processor=loadProcessor({Deno:{env:{get:()=>''},serve:()=>{}},createClient:()=>db,createNoteAIJobs,NoteAIJobError,classifyNoteAIError,handleNoteAIRequest,checkBalance:async()=>{balanceCalls++;return {allowed:false}},console:{log:()=>{},warn:()=>{},error:()=>{}}});
 await processor.processInBackground(lease,'Bearer service');expect(balanceCalls).toBe(0);
});
it('retains invalid metadata as a permanent outcome rather than false successful defaults',async()=>{
 const lease={id:'j',user_id:'u',note_id:'n',lease_id:'l',pipeline:'analysis',desired_generation:1,captured_generation:1,fingerprint:'f',snapshot:{id:'n',user_id:'u',title:'Fixture',content:'Fixture content text',media:[]}};
 const db={rpc:async(name:string)=>({data:name==='get_note_ai_job_snapshot'?lease:name==='begin_note_ai_stage'?{status:'started'}:true,error:null})};
 const processor=loadProcessor({Deno:{env:{get:()=>''},serve:()=>{}},createClient:()=>db,createNoteAIJobs,NoteAIJobError,classifyNoteAIError,handleNoteAIRequest,checkBalance:async()=>({allowed:true}),runChat:async()=>({content:'invalid fixture'}),parseModelJson:()=>null,PROCESS_NOTE_METADATA_PROMPT:'fixture',metadataFieldContract:()=>'',sourceLanguageRule:()=>'',console:{log:()=>{},warn:()=>{},error:()=>{}}});
 await expect(processor.processInBackground(lease,'Bearer service')).rejects.toMatchObject({kind:'permanent'});
});
it.each([{ai_visibility:'hidden'},{source_app:'hub'}])('indexes restricted snapshots without derivative reads or writes: %j',async(restriction)=>{
 let derivatives=0;const lease={id:'j',user_id:'u',note_id:'n',lease_id:'l',pipeline:'analysis',desired_generation:1,captured_generation:1,fingerprint:'f',snapshot:{id:'n',user_id:'u',title:'Fixture',content:'Fixture content text',media:[],...restriction}};
 const db={rpc:async(name:string)=>({data:name==='get_note_ai_job_snapshot'?lease:name==='begin_note_ai_stage'?{status:'started'}:true,error:null}),from:()=>{derivatives++;throw Error('unexpected derivative')}};
 const processor=loadProcessor({Deno:{env:{get:()=>''},serve:()=>{}},createClient:()=>db,createNoteAIJobs,NoteAIJobError,classifyNoteAIError,handleNoteAIRequest,checkBalance:async()=>({allowed:true}),runChat:async()=>({content:'{"topics":[]}'}),parseModelJson:JSON.parse,noteContentHash:()=> 'h',shouldExtractFacts:(s:string)=>s!=='hub',embedAndStoreNoteChunks:async()=>({firstChunkEmbedding:[1],chunkCount:1,failures:0}),PROCESS_NOTE_METADATA_PROMPT:'fixture',metadataFieldContract:()=>'',sourceLanguageRule:()=>'',console:{log:()=>{},warn:()=>{},error:()=>{}}});
 await processor.processInBackground(lease,'Bearer service');expect(derivatives).toBe(0);
});
const owned={id:'n',user_id:'u'};
function fixture(internal=false) {
 const calls:string[]=[];
 return {calls, deps:{isService:()=>internal,authenticate:async()=> 'u',findNote:async()=>owned,
 jobs:{claimExecution:async()=>true,enqueue:async(...args:any[])=>{calls.push(`enqueue:${args[3]}`);return {id:'j',state:'pending'}},getLease:async()=>({id:'j',note_id:'n',user_id:'u',pipeline:'analysis'}),},
 execute:async()=>{calls.push('execute')},}};
}
describe('analysis request compatibility',()=>{
 it('requires verified administrator identity for deliberate reanalysis',async()=>{
  const {deps,calls}=fixture();(deps as any).isAdmin=async()=>false;(deps.jobs as any).reanalyze=async()=>{calls.push('reanalyze');return {id:'j',state:'pending'}};
  expect((await handleNoteAIRequest({note_id:'n',reason:'admin_reanalysis'},'Bearer user',deps as any)).status).toBe(403);expect(calls).toEqual([]);
  (deps as any).isAdmin=async()=>true;
  expect((await handleNoteAIRequest({note_id:'n',reason:'admin_reanalysis'},'Bearer user',deps as any)).status).toBe(202);expect(calls).toEqual(['reanalyze']);
 });
 it('admits only one concurrent execution of the same valid lease',async()=>{
  const {deps,calls}=fixture(true);let admitted=false;
  (deps.jobs as any).claimExecution=async()=>{if(admitted)return false;admitted=true;return true};
  const body={note_id:'n',execute:true,job_id:'j',lease_id:'l',user_id:'u'};
  const responses=await Promise.all([handleNoteAIRequest(body,'Bearer service',deps as any),handleNoteAIRequest(body,'Bearer service',deps as any)]);
  expect(responses.map(r=>r.status).sort()).toEqual([200,409]);expect(calls).toEqual(['execute']);
 });
 it('rejects execution body flags from user JWTs',async()=>{
  const {deps,calls}=fixture();
  expect((await handleNoteAIRequest({note_id:'n',execute:true,job_id:'j',lease_id:'l',user_id:'u'},'Bearer user',deps as any)).status).toBe(403);
  expect(calls).toEqual([]);
 });
 it('service execution waits for completion and checks lease tenant and note',async()=>{
  const {deps,calls}=fixture(true);
  const result=await handleNoteAIRequest({note_id:'n',execute:true,job_id:'j',lease_id:'l',user_id:'u'},'Bearer service',deps as any);
  expect(result.body.finished).toBe(true);expect(result.status).toBe(200);expect(calls).toEqual(['execute']);
  deps.jobs.getLease=async()=>({id:'j',note_id:'another',user_id:'u',pipeline:'analysis'});
  expect((await handleNoteAIRequest({note_id:'n',execute:true,job_id:'j',lease_id:'l',user_id:'u'},'Bearer service',deps as any)).status).toBe(409);
 });
 it('ordinary authenticated requests queue without buying analysis even with force',async()=>{
  const {deps,calls}=fixture();
  const result=await handleNoteAIRequest({note_id:'n',force:true},'Bearer user',deps as any);
  expect(result.status).toBe(202);expect(result.body).toMatchObject({ok:true,queued:true,processing:false});expect(calls).toEqual(['enqueue:automatic']);
 });
});
