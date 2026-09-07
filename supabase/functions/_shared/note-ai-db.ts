import { AsyncLocalStorage } from 'node:async_hooks';
import { NoteAIJobError } from './note-ai-jobs.ts';
// Legacy extraction helpers often catch DB errors. Remember them per execution,
// so a swallowed error can never acknowledge the pipeline or buy its next stage.
export function createNoteAIExecutionDatabase<T extends object>(raw: T) {
 const contexts = new AsyncLocalStorage<{userId:string;beforeWrite:()=>Promise<unknown>;failure?:unknown}>();
 function remember(error:unknown) { const context=contexts.getStore(); if(context && !context.failure) context.failure=error; }
 async function inspect(result:PromiseLike<any>) {
  try {
   const response=await result;
   // Unique violations are deliberate idempotency decisions in existing helpers.
   if(response?.error && response.error.code!=='23505') throw new NoteAIJobError('transient','Analysis database operation failed');
   return response;
  } catch(error) {remember(error);throw error}
 }
 function query(builder:any, write=false):any {
  return new Proxy(builder,{get(target,key){
   if(key==='then') return (resolve:any,reject:any)=> (async()=>{
    const context=contexts.getStore();
    if(context?.failure) throw context.failure;
    if(write && context) {try{await context.beforeWrite()}catch(error){remember(error);throw error}}
    return inspect(target);
   })().then(resolve,reject);
   const value=Reflect.get(target,key);
   if(typeof value!=='function')return value;
   return (...args:any[])=>query(value.apply(target,args),write||['insert','upsert','update','delete'].includes(String(key)));
  }});
 }
 const db=new Proxy(raw,{get(target:any,key){
  if(key==='from')return (...args:any[])=>query(target.from(...args));
  if(key==='rpc')return (...args:any[])=>{
   const context=contexts.getStore();
   if(context?.failure)return Promise.reject(context.failure);
   return inspect(target.rpc(...args));
  };
  const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
 }});
 return {db,run:<R>(userId:string,beforeWrite:()=>Promise<unknown>,task:()=>Promise<R>):Promise<R>=>contexts.run({userId,beforeWrite},async()=>{
  const result=await task();const failure=contexts.getStore()?.failure;if(failure)throw failure;return result;
 })};
}
