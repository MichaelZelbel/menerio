// Real Chromium + IndexedDB. Only the authentication/network services are synthetic.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createServer } from 'node:http';
const { chromium } = await import(process.env.REVIEW_PLAYWRIGHT_MODULE ?? 'playwright');
const fakeAuth = `
const listeners = new Set();
const channel = new BroadcastChannel('review-auth-fixture');
const session = id => id ? { user: {id}, access_token: 'synthetic' } : null;
function emit(id) { for(const fn of listeners) fn('SIGNED_IN',session(id)); }
channel.onmessage = event => emit(event.data);
window.switchFixtureAccount = id => { localStorage.setItem('review-auth-owner',id || ''); emit(id); channel.postMessage(id); };
export const supabase = {
 auth: { onAuthStateChange: fn => { listeners.add(fn); return {data:{subscription:{unsubscribe:()=>listeners.delete(fn)}}}; },
 getSession: async()=>({data:{session:session(localStorage.getItem('review-auth-owner'))}}) },
 from: table => { let owner; const q={select:()=>q,eq:(_,v)=>{owner=v;return q},single:async()=>{
   await new Promise(r=>setTimeout(r,owner==='A'?250:0));
   return {data:table==='profiles'?{id:owner,display_name:owner+' profile'}:{role:'free'}};
 }};return q;}
};`;
const built = await build({ entryPoints: ['scripts/review-browser-fixture.tsx'], bundle:true, write:false, format:'iife', platform:'browser', jsx:'automatic',
  define: {'process.env.NODE_ENV':'"test"', 'import.meta.env':'{}'}, plugins:[{name:'synthetic-services',setup(b){
    b.onResolve({filter:/^@\/(integrations\/supabase\/client|lib\/flags|sync\/db)$/},a=>({path:a.path,namespace:'fake'}));
    b.onLoad({filter:/.*/,namespace:'fake'},a=>({contents:a.path.endsWith('/client')?fakeAuth:a.path.endsWith('/flags')?'export const OFFLINE_CORE=false;':'export const getDb=()=>({disconnectAndClear:async()=>{}});',loader:'js'}));
  }}] });
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/app.js'?'application/javascript':'text/html');res.end(req.url==='/app.js'?built.outputFiles[0].text:'<!doctype html><div id="root"></div><script src="/app.js"></script>');});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,...(process.env.REVIEW_CHROME?{executablePath:process.env.REVIEW_CHROME}:{})});
const context=await browser.newContext();
await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
const a=await context.newPage(),b=await context.newPage(),errors=[];
for(const p of [a,b])p.on('pageerror',e=>errors.push(e.message));
async function expectOwner(page,owner){await page.waitForFunction(owner=>document.querySelector('#owner')?.textContent===owner,owner);}
async function expectData(page,owner){await page.waitForFunction(owner=>document.querySelector('#group')?.textContent===owner+' private group'&&document.querySelector('#note')?.textContent===owner+' private note',owner);}
try {
 await a.goto(base);await b.goto(base);await expectOwner(a,'signed-out');
 await a.evaluate(()=>window.switchFixtureAccount('A'));await expectData(a,'A');await expectData(b,'A');
 await a.evaluate(()=>window.switchFixtureAccount('B'));await expectData(a,'B');await expectData(b,'B');
 await a.waitForTimeout(300);assert.equal(await a.locator('#profile').textContent(),'B profile');
 await a.evaluate(()=>window.switchFixtureAccount(null));await expectOwner(a,'signed-out');await expectOwner(b,'signed-out');
 assert.equal(await a.locator('#group').textContent(),'');
 await a.evaluate(()=>window.switchFixtureAccount('B'));await expectData(a,'B');await expectData(b,'B');
 // Let the actual query persister commit. Reload with every query function failing.
 await a.waitForTimeout(100);await a.evaluate(()=>sessionStorage.setItem('fixture-offline','1'));
 await a.reload();await expectData(a,'B');
 // Real IndexedDB commits and browser Web Locks across two tabs.
 await Promise.all([a,b].map((page,index)=>page.evaluate(async index=>{
  const {readRecovery,writeRecovery,withRecoveryLock}=window.recoveryFixture;
  await withRecoveryLock('B',async()=>{const rows=await readRecovery('B');rows.push({id:'batch-'+index,operations:[],completed:0,status:'recovery',createdAt:new Date().toISOString()});await writeRecovery('B',rows);});
 },index)));
 await a.reload();await expectData(a,'B');
 assert.equal(await a.evaluate(async()=> (await window.recoveryFixture.readRecovery('B')).length),2);
 assert.equal(await a.evaluate(async()=> (await window.recoveryFixture.readRecovery('A')).length),0);
 assert.deepEqual(errors,[]);
 console.log('Chromium passed: actual AuthProvider account changes in two tabs, same-slug/bookmark isolation, delayed profile, offline query reload, real IndexedDB recovery reload and concurrent tab writes.');
} catch(error) { console.error('Browser fixture diagnostics:',errors,await a.locator('body').innerText()); throw error;
} finally {await browser.close();await new Promise(r=>server.close(r));}
