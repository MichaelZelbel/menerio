import { mkdir } from 'node:fs/promises';
import { build } from 'esbuild';
await mkdir('.superpowers/contact-topics',{recursive:true});
await build({entryPoints:['supabase/functions/menerio-mcp/index.ts'],outfile:'.superpowers/contact-topics/mcp.mjs',bundle:true,platform:'node',format:'esm',packages:'external',plugins:[{name:'edge-test',setup(b){
 b.onResolve({filter:/^jsr:/},()=>({path:'empty',namespace:'empty'})); b.onLoad({filter:/.*/,namespace:'empty'},()=>({contents:''}));
 b.onResolve({filter:/^https:\/\/esm.sh\/@supabase\/supabase-js/},()=>({path:'@supabase/supabase-js',external:true}));
}}]});
