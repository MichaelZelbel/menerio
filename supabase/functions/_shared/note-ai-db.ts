import { AsyncLocalStorage } from 'node:async_hooks';
import { NoteAIJobError } from './note-ai-jobs.ts';
export interface NoteAIExecutionDatabaseOptions {
 /**
  * Error codes a table's caller reads as an answer, not as a failed operation.
  * writeFact turns the claim guards' 23514 into "rejected"; raised here instead,
  * one "None." in a note failed its whole analysis job on every retry.
  */
 refusals?: Record<string, string[]>;
 /**
  * RPCs whose caller handles its own failure by design (a fail-open check).
  * Remembered as a failure, the repeat-call check's error let the provider be
  * paid and then refused the deduction and the checkpoint of that answer.
  */
 failOpenRpcs?: string[];
}
// Legacy extraction helpers often catch DB errors. Remember them per execution,
// so a swallowed error can never acknowledge the pipeline or buy its next stage.
export function createNoteAIExecutionDatabase<T extends object>(raw: T, options: NoteAIExecutionDatabaseOptions = {}) {
 const contexts = new AsyncLocalStorage<{userId:string;beforeWrite:()=>Promise<unknown>;failure?:unknown}>();
 function remember(error:unknown) { const context=contexts.getStore(); if(context && !context.failure) context.failure=error; }
 async function inspect(result:PromiseLike<any>, table?:string) {
  try {
   const response=await result;
   // Unique violations are deliberate idempotency decisions in existing helpers.
   const answered=response?.error && table!==undefined && (options.refusals?.[table] ?? []).includes(response.error.code);
   if(response?.error && response.error.code!=='23505' && !answered) {
    // Name the cause: the generic message hid a 22P02 for weeks.
    console.error('[note-ai-db] database operation failed',response.error.code,response.error.message);
    throw new NoteAIJobError('transient',`Analysis database operation failed (${response.error.code||'?'}): ${response.error.message||''}`);
   }
   return response;
  } catch(error) {remember(error);throw error}
 }
 function query(builder:any, write=false, table?:string):any {
  return new Proxy(builder,{get(target,key){
   if(key==='then') return (resolve:any,reject:any)=> (async()=>{
    const context=contexts.getStore();
    if(context?.failure) throw context.failure;
    if(write && context) {try{await context.beforeWrite()}catch(error){remember(error);throw error}}
    return inspect(target,table);
   })().then(resolve,reject);
   const value=Reflect.get(target,key);
   if(typeof value!=='function')return value;
   return (...args:any[])=>query(value.apply(target,args),write||['insert','upsert','update','delete'].includes(String(key)),table);
  }});
 }
 const db=new Proxy(raw,{get(target:any,key){
  if(key==='from')return (...args:any[])=>query(target.from(...args),false,String(args[0]));
  if(key==='rpc')return (...args:any[])=>{
   const context=contexts.getStore();
   if(context?.failure)return Promise.reject(context.failure);
   if(options.failOpenRpcs?.includes(String(args[0])))return target.rpc(...args);
   return inspect(target.rpc(...args));
  };
  const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
 }});
 return {db,run:<R>(userId:string,beforeWrite:()=>Promise<unknown>,task:()=>Promise<R>):Promise<R>=>contexts.run({userId,beforeWrite},async()=>{
  const result=await task();const failure=contexts.getStore()?.failure;if(failure)throw failure;return result;
 })};
}
