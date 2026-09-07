import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
const base=process.env.CONTACT_TOPICS_TEST_HTTP_URL;
if(!base || !/^http:\/\/(127\.0\.0\.1|localhost|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+):4175$/.test(base))throw new Error('Explicit local disposable HTTP adapter required');
const {chromium}=await import(process.env.CONTACT_TOPICS_PLAYWRIGHT_MODULE??'playwright');
const fixture=await fetch(base+'/fixture').then(r=>r.json());
const client=new Client({name:'browser-acceptance',version:'1'});
await client.connect(new StreamableHTTPClientTransport(new URL(base+'/mcp'),{requestInit:{headers:{Authorization:'Bearer mnr_topics_owner'}}}));
const call=async(name,args)=>{const r=await client.callTool({name,arguments:args});assert(!r.isError,JSON.stringify(r));return JSON.parse(r.content[0].text);};
const browser=await chromium.launch({headless:true,...(process.env.CONTACT_TOPICS_CHROME?{executablePath:process.env.CONTACT_TOPICS_CHROME}:{})});
const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));
// Deny any accidental request to a real backend from this synthetic harness.
await page.route('**/*',route=>{const url=new URL(route.request().url());return ['127.0.0.1','localhost',new URL(base).hostname].includes(url.hostname)?route.continue():route.abort();});
const runId=randomUUID().slice(0,8), once=`Synthetic garden ${runId}`, repeat=`Synthetic recurring ${runId}`, edited=repeat+' revised';
const captureDir='.superpowers/contact-topics/screenshots';await mkdir(captureDir,{recursive:true});
try{
 const previous=await call('list_contact_topics',{contact_id:fixture.person,limit:100});
 for(const topic of previous.topics)await call('archive_contact_topic',{topic_id:topic.id,expected_version:topic.version,request_id:randomUUID()});
 await page.goto('http://127.0.0.1:5179');
 await page.getByRole('heading',{name:'Topics to talk about',exact:true}).waitFor();
 await page.getByRole('textbox',{name:'New topic',exact:true}).fill(once);
 await page.getByRole('textbox',{name:'New topic',exact:true}).press('Enter');
 await page.getByRole('checkbox',{name:`Discussed: ${once}`,exact:true}).waitFor();
 const uiCreated=(await call('list_contact_topics',{contact_id:fixture.person,query:once})).topics[0];
 assert.equal(uiCreated.mode,'one_off');assert.equal(uiCreated.priority,'normal');
 await page.getByRole('checkbox',{name:`Discussed: ${once}`,exact:true}).click();
 await page.getByText('Discussion saved. Topic moved to Discussed.',{exact:true}).waitFor();
 const uiHistory=await call('get_contact_topic_history',{topic_id:uiCreated.id});assert(uiHistory.events.some(e=>e.action==='discuss'&&e.after_state.title===once));
 const mcpCreated=await call('create_contact_topic',{contact_id:fixture.person,title:repeat,mode:'recurring',priority:'high',request_id:randomUUID()});
 // Realtime is deliberately disconnected in the local adapter. Verify the
 // actual visible-page 30-second fallback without focus/reload assistance.
 await page.getByRole('listitem',{name:repeat,exact:true}).waitFor({timeout:40000});
 const row=()=>page.getByRole('listitem',{name:repeat,exact:true});
 const topicAction=async(title,action)=>{await page.getByRole('listitem',{name:title,exact:true}).getByRole('button',{name:'Topic options: '+title,exact:true}).click();await page.getByRole('menuitem',{name:action,exact:true}).click();};
 await row().getByRole('checkbox',{name:'Discussed today: '+repeat,exact:true}).click();
 await page.getByText('Discussion saved. This recurring topic stays on your list.',{exact:true}).waitFor();
 let current=(await call('list_contact_topics',{contact_id:fixture.person,query:repeat})).topics[0];assert.equal(current.status,'active');assert(current.last_discussed_at);
 await topicAction(repeat,'Edit');await row().getByRole('textbox',{name:'Edit topic title'}).fill(edited);await row().getByRole('button',{name:'Save',exact:true}).click();
 await page.getByRole('listitem',{name:edited,exact:true}).waitFor();
 let hist=await call('get_contact_topic_history',{topic_id:mcpCreated.topic.id});assert(hist.events.some(e=>e.action==='discuss'&&e.after_state.title===repeat));
 await topicAction(edited,'History');
 await page.getByRole('list',{name:'Topic history'}).getByText(repeat,{exact:true}).first().waitFor();
 current=(await call('list_contact_topics',{contact_id:fixture.person,query:edited})).topics[0];
 await call('discuss_contact_topic',{topic_id:current.id,expected_version:current.version,close_after:true,request_id:randomUUID()});
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await page.getByRole('combobox',{name:'Topic view'}).selectOption('completed');
 await page.getByRole('listitem',{name:edited,exact:true}).waitFor();
 await topicAction(edited,'Reopen');
 await page.getByRole('combobox',{name:'Topic view'}).selectOption('active');
 await topicAction(edited,'Archive');
 await page.getByRole('combobox',{name:'Topic view'}).selectOption('archived');await page.getByRole('listitem',{name:edited,exact:true}).waitFor();
 await page.getByRole('button',{name:'Undo last change',exact:true}).click();await page.getByRole('combobox',{name:'Topic view'}).selectOption('active');
 await page.getByRole('listitem',{name:edited,exact:true}).waitFor();
 for(let i=0;i<6;i++)await call('create_contact_topic',{contact_id:fixture.person,title:`Synthetic preview ${runId} ${i}`,priority:i===5?'high':'low',request_id:randomUUID()});
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.getByRole('button',{name:/Show all \d+ topics/}).waitFor();
 const topicPanel=page.getByLabel('Topics to talk about with Synthetic Alex',{exact:true});
 const rows=topicPanel.locator(':scope > div > ul > li');assert.equal(await rows.count(),5);
 assert((await rows.allTextContents()).some(t=>t.includes(`Synthetic preview ${runId} 5`)));
 await page.screenshot({path:captureDir+'/desktop-light.png',fullPage:true});
 for(const theme of ['light','dark']){
  await page.setViewportSize({width:390,height:844});await page.evaluate(t=>localStorage.setItem('theme',t),theme);await page.reload();await page.getByRole('heading',{name:'Topics to talk about',exact:true}).waitFor();await page.waitForTimeout(400);
  await page.screenshot({path:captureDir+`/mobile-${theme}.png`,fullPage:true});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No horizontal overflow at 390px');
 }
 await page.setViewportSize({width:1280,height:900});await page.evaluate(()=>localStorage.setItem('theme','dark'));await page.reload();await page.getByRole('heading',{name:'Topics to talk about',exact:true}).waitFor();await page.waitForTimeout(400);await page.screenshot({path:captureDir+'/desktop-dark.png',fullPage:true});
 await page.getByRole('tab',{name:'Conversation',exact:true}).click();await page.getByText('Conversation context',{exact:false}).first().waitFor({timeout:5000}).catch(()=>{});
 assert.equal(await page.getByRole('tab',{name:'Conversation',exact:true}).getAttribute('aria-selected'),'true');
 assert.deepEqual(errors,[]);
 console.log('Actual PersonDetail UI: keyboard create to MCP, UI discussion to MCP history, MCP capture to open profile via 30s fallback, recurring discussion, original history wording after edit, MCP close to UI, reopen/archive/undo, priority preview, Conversation tab, 390px and desktop light/dark passed.');
}finally{await browser.close();await client.close();}
