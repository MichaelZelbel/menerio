import { describe, it, expect } from 'vitest';
import { createNoteAIJobs, type NoteAILease } from '../note-ai-jobs';
const lease = { id:'job', user_id:'u', note_id:'n', pipeline:'analysis', lease_id:'token', captured_generation:1, desired_generation:1, fingerprint:'sha', snapshot:{} } as NoteAILease;
function database() {
  const events:string[]=[];
  const stages = new Map<string, any>();
  let current:any = lease;
  return { events, stages, setCurrent:(value:any)=>{current=value}, async rpc(name:string,args:any) {
    events.push(name);
    const stage=args._stage;
    if(name==='get_note_ai_job_snapshot') return { data:current,error:null };
    if(name==='begin_note_ai_stage') return {data:stages.get(stage) ?? {status:'started'},error:null};
    if(name==='checkpoint_note_ai_stage') stages.set(stage,{status:'checkpointed',result:args._result});
    if(name==='apply_note_ai_stage') stages.set(stage,{status:'applied',result:stages.get(stage)?.result});
    return {data:true,error:null};
  }};
}
describe('durable note stages',()=>{
  it('rejects a stale atomic chunk replacement',async()=>{
    const db=database();const original=db.rpc.bind(db);db.rpc=async(n,a)=>n==='replace_note_ai_chunks'?{data:false,error:null}:original(n,a);
    await expect(createNoteAIJobs(db).replaceChunks(lease,[])).rejects.toMatchObject({kind:'stale'});
  });
  it('does not reuse an erased applied result in an active pipeline',async()=>{
    const db=database();db.stages.set('metadata',{status:'applied',result:null});
    await expect(createNoteAIJobs(db).runStage(lease,'metadata',async()=>({}))).rejects.toMatchObject({kind:'permanent'});
  });
  it('parks unknown provider failures as uncertain but preserves known allowance errors',async()=>{
    const jobs=createNoteAIJobs(database());
    await expect(jobs.runStage(lease,'metadata',async()=>{throw Error('network timeout')})).rejects.toMatchObject({kind:'uncertain'});
    await expect(jobs.runStage(lease,'profile',async()=>{throw Error('INSUFFICIENT_CREDITS')})).rejects.toThrow('INSUFFICIENT_CREDITS');
    await expect(jobs.runStage(lease,'moment',async()=>{throw Error('BALANCE_UNAVAILABLE')})).rejects.toThrow('BALANCE_UNAVAILABLE');
  });
  it('uses atomic generation-fenced note writes and refuses stale output',async()=>{
    const db=database();const argsSeen:any[]=[];const original=db.rpc.bind(db);
    db.rpc=async(n,a)=>{if(n==='apply_note_ai_output'){argsSeen.push(a);return {data:false,error:null}}return original(n,a)};
    await expect(createNoteAIJobs(db).applyNote(lease,{metadata:{topics:[]},title:'Generated fixture',finish:true})).rejects.toMatchObject({kind:'stale'});
    expect(argsSeen[0]).toMatchObject({_job_id:'job',_user_id:'u',_lease_id:'token',_finish:true,_title:'Generated fixture'});
  });
  it('never contacts a provider when begin rejected the lease',async()=>{
    let paid=0;const db=database();const original=db.rpc.bind(db);db.rpc=async(n,a)=>n==='begin_note_ai_stage'?{data:null,error:null}:original(n,a);
    await expect(createNoteAIJobs(db).runStage(lease,'metadata',async()=>{paid++;return {}})).rejects.toMatchObject({kind:'stale'});expect(paid).toBe(0);
  });
  it('records uncertain billing when saving an answered stage fails',async()=>{
    const db=database();const original=db.rpc.bind(db);db.rpc=async(n,a)=>n==='checkpoint_note_ai_stage'?{data:null,error:{message:'db down'}}:original(n,a);
    await expect(createNoteAIJobs(db).runStage(lease,'metadata',async()=>({paid:true}))).rejects.toMatchObject({kind:'uncertain'});
  });
  it('checkpoints paid result before effects and reuses it after an effect failure',async()=>{
    const db=database(); const jobs=createNoteAIJobs(db); let paid=0; let effects=0;
    const produce=async()=>{paid++;return {facts:['fixture']}};
    const apply=async(value:any)=>{expect(value.facts).toEqual(['fixture']);expect(db.stages.get('profile').status).toBe('checkpointed');if(++effects===1)throw Error('write failed')};
    await expect(jobs.runStage(lease,'profile',produce,apply)).rejects.toThrow('write failed');
    await jobs.runStage(lease,'profile',produce,apply);
    await jobs.runStage(lease,'profile',produce,apply);
    expect(paid).toBe(1);expect(effects).toBe(2);
  });
});
