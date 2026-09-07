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
});
