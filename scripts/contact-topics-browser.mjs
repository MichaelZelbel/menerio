import { createServer } from 'vite';
import react from '@vitejs/plugin-react-swc';
import path from 'node:path';
const backend=process.env.CONTACT_TOPICS_TEST_HTTP_URL;
if(!backend || !/^http:\/\/(127\.0\.0\.1|localhost|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+):4175$/.test(backend))throw new Error('Local synthetic backend required');
const root=process.cwd();
const server=await createServer({configFile:false,root,optimizeDeps:{entries:['scripts/contact-topics-browser/main.tsx']},plugins:[react(),{name:'synthetic-page',configureServer(s){s.middlewares.use(async(req,res,next)=>{if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end(await s.transformIndexHtml('/', '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/scripts/contact-topics-browser/main.tsx"></script></body></html>'));}else next();});}}],define:{'import.meta.env.TOPIC_TEST_BACKEND':JSON.stringify(backend)},resolve:{alias:[
{find:'@/integrations/supabase/client',replacement:path.join(root,'scripts/contact-topics-browser/client.ts')},
{find:'@/contexts/AuthContext',replacement:path.join(root,'scripts/contact-topics-browser/auth.ts')},
{find:'@',replacement:path.join(root,'src')},
]},server:{host:'127.0.0.1',port:5179,strictPort:true}});
await server.listen();console.log('Synthetic PersonDetail browser harness http://127.0.0.1:5179');
