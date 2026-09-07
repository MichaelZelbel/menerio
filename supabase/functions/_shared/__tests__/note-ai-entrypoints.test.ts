import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {it,expect} from 'vitest';
import {createNoteAIJobs} from '../note-ai-jobs';
function load(path:string,bindings:Record<string,unknown>,suffix=''){
 const source=readFileSync(path,'utf8').replace(/^import[\s\S]*?from\s+["'][^"']+["'];\s*/gm,'');
 return new Function('exports',...Object.keys(bindings),ts.transpileModule(source+'\n'+suffix,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText)({},...Object.values(bindings));
}
it('real sweep reconciles through enqueue RPC instead of dispatching execution',async()=>{
 let handler:any;const queued:any[]=[];let dispatches=0;
 const db={auth:{getUser:async()=>({data:{user:{id:'u'}}})},rpc:async(n:string,args:any)=>{queued.push({n,args});return {data:{id:'j'},error:null}},from:()=>{const q:any=new Proxy({}, {get:(_,key)=>key==='then'?(resolve:any)=>Promise.resolve({data:[{id:'n',updated_at:'2020-01-01',processing_status:null,embedding:null}],error:null}).then(resolve):()=>q});return q}};
 load('supabase/functions/sweep-note-processing/index.ts',{Deno:{env:{get:()=>''},serve:(fn:any)=>handler=fn},createClient:()=>db,createNoteAIJobs,fetch:async()=>{dispatches++;return {ok:true}},Response});
 const result=await handler(new Request('http://fixture',{method:'POST',headers:{Authorization:'Bearer fixture'},body:'{}'}));
 expect(result.status).toBe(200);expect(await result.json()).toMatchObject({triggered:1,ids:['n']});expect(dispatches).toBe(0);expect(queued[0]).toMatchObject({n:'enqueue_note_ai_job',args:{_user_id:'u',_note_id:'n',_pipeline:'analysis',_reason:'automatic'}});
});
it('real media persistence throws a failed write rather than reporting completion',async()=>{
 const db={from:()=>{const q:any=new Proxy({}, {get:(_,key)=>key==='then'?(resolve:any)=>Promise.resolve({data:null,error:{message:'fixture write failed'}}).then(resolve):()=>q});return q}};
 const api=load('supabase/functions/analyze-media/index.ts',{Deno:{env:{get:()=>''},serve:()=>{}},createClient:()=>db,createNoteAIJobs,console:{warn:()=>{},log:()=>{}},getEmbeddingWithCredits:async()=>({embedding:[1]})},'return {writeAnalysisRecord};');
 await expect(api.writeAnalysisRecord({userId:'u',noteId:'n',storagePath:'fixture',mediaType:'image',pageNumber:1,description:'fixture'})).rejects.toThrow('fixture write failed');
});
