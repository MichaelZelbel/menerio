// Local HTTP mock executors, never provider traffic. Run separately from fast tests.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import assert from 'node:assert/strict';
import { transform } from 'esbuild';
const source=await readFile(new URL('../supabase/functions/_shared/note-ai-worker.ts',import.meta.url),'utf8');
const {code}=await transform(source,{loader:'ts',format:'esm'});
const {drainNoteAiJobs}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
let active=0,peak=0,requests=0,delay=120;
const server=createServer((_req,res)=>{
  active++;requests++;peak=Math.max(peak,active);
  setTimeout(()=>{active--;res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({fixture:true,finished:true}));},delay);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const endpoint=`http://127.0.0.1:${server.address().port}`;
try {
  for (const ms of [120,70_000]) {
    delay=ms;peak=0;requests=0;let id=0;
    const started=performance.now();
    const result=await drainNoteAiJobs({
      enabled:true,
      claim:async()=>({id:String(id++),user_id:'synthetic-fixture',note_id:'synthetic-note',pipeline:'analysis',lease_id:'synthetic-lease'}),
      dispatch:async()=>{const response=await fetch(endpoint);const body=await response.json();assert.equal(body.fixture,true);return {status:response.status,finished:body.finished};},
      fail:async()=>{throw new Error('Unexpected local mock execution failure');},
    });
    assert.equal(peak,2);assert.equal(result.finished,ms===120?10:2);assert.equal(requests,result.finished);
    console.log(JSON.stringify({test:'LOCAL_HTTP_FIXTURE',mockDelayMs:ms,peak,requests,result,wallMs:Math.round(performance.now()-started)}));
  }
} finally {await new Promise(resolve=>server.close(resolve));}
