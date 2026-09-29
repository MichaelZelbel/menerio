import {describe,it,expect} from 'vitest';
import {createNoteAIExecutionDatabase} from '../note-ai-db';
describe('analysis database failures',()=>{
 it('cannot report success when a legacy helper swallowed a database write failure',async()=>{
  const raw={from:()=>{const q:any={insert:()=>q,then:(resolve:any)=>Promise.resolve({error:{code:'XX001',message:'fixture db failure'},data:null}).then(resolve)};return q}};
  const execution=createNoteAIExecutionDatabase(raw);
  await expect(execution.run('owner',async()=>{},async()=>{
   try{await execution.db.from('review_queue').insert({user_id:'owner'})}catch{/* legacy helper */}
  })).rejects.toMatchObject({kind:'transient'});
 });
 it('keeps parallel execution fences isolated and refuses effects after revision changes',async()=>{
  let writes=0;const raw={from:()=>{const q:any={insert:()=>q,then:(resolve:any)=>{writes++;return Promise.resolve({data:[],error:null}).then(resolve)}};return q}};
  const execution=createNoteAIExecutionDatabase(raw);
  const stale=execution.run('a',async()=>{throw Error('stale fixture')},()=>execution.db.from('review_queue').insert({user_id:'a'}));
  const valid=execution.run('b',async()=>{},()=>execution.db.from('review_queue').insert({user_id:'b'}));
  await expect(stale).rejects.toThrow('stale fixture');await valid;expect(writes).toBe(1);
 });
 const refusing=(code:string)=>({rpc:async()=>({data:null,error:{code:'XX001',message:'fixture rpc failure'}}),from:()=>{const q:any={insert:()=>q,select:()=>q,maybeSingle:()=>q,then:(resolve:any)=>Promise.resolve({data:null,error:{code,message:'claim_quality_guard: fixture'}}).then(resolve)};return q}});
 it('hands a named refusal to the caller instead of failing the job',async()=>{
  const execution=createNoteAIExecutionDatabase(refusing('23514'),{refusals:{claims:['23514']}});
  const response=await execution.run('owner',async()=>{},()=>execution.db.from('claims').insert({}).select('id').maybeSingle());
  expect(response.error.code).toBe('23514');
  // Only for the table it is named for, and only that code.
  await expect(execution.run('owner',async()=>{},()=>execution.db.from('review_queue').insert({}))).rejects.toMatchObject({kind:'transient'});
  const other=createNoteAIExecutionDatabase(refusing('23502'),{refusals:{claims:['23514']}});
  await expect(other.run('owner',async()=>{},()=>other.db.from('claims').insert({}))).rejects.toMatchObject({kind:'transient'});
  const plain=createNoteAIExecutionDatabase(refusing('23514'));
  await expect(plain.run('owner',async()=>{},()=>plain.db.from('claims').insert({}))).rejects.toMatchObject({kind:'transient'});
 });
 it('lets a fail-open rpc fail open without poisoning the execution',async()=>{
  const execution=createNoteAIExecutionDatabase(refusing('23514'),{failOpenRpcs:['llm_note_call_fingerprint']});
  const response=await execution.run('owner',async()=>{},async()=>{
   const answer=await execution.db.rpc('llm_note_call_fingerprint',{});
   return answer;
  });
  expect(response.error.code).toBe('XX001');
  await expect(execution.run('owner',async()=>{},()=>execution.db.rpc('deduct_ai_tokens_attributed',{}))).rejects.toMatchObject({kind:'transient'});
 });
});
