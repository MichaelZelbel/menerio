import {it,expect,vi,afterEach} from 'vitest';
import {getEmbeddingWithCredits} from '../llm-credits';
afterEach(()=>vi.unstubAllGlobals());
it('deducts an embedding once with exact note job revision and stage attribution',async()=>{
 const ledger:any[]=[];
 const db={from:()=>{const q:any=new Proxy({}, {get:(_,key)=>key==='then'?(resolve:any)=>Promise.resolve({data:[{remaining_tokens:10000,remaining_credits:10}],error:null}).then(resolve):()=>q});return q},rpc:async(name:string,args:any)=>{ledger.push({name,args});return {data:{allowed:true,remaining_tokens:9997,remaining_credits:9,usage_event_id:'event-fixture'},error:null}}};
 vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,json:async()=>({data:[{embedding:[0.2]}],usage:{total_tokens:3,prompt_tokens:3}})})));
 await getEmbeddingWithCredits(db,'fixture-key','u','process-note','Synthetic fixture',{noteId:'n',jobId:'j',revision:'sha',stage:'embedding:hash',callSite:'process-note.embedding'});
 expect(ledger).toHaveLength(1);expect(ledger[0].args).toMatchObject({p_note_id:'n',p_job_id:'j',p_revision:'sha',p_stage:'embedding:hash',p_call_site:'process-note.embedding',p_tokens:3});
});
