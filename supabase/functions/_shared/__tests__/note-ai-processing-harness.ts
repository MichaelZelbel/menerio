import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { createNoteAIExecutionDatabase } from '../note-ai-db';
import { selectAllRows } from '../paged-select';
import { suppressionKey, writeFact } from '../fact-store';
import { normalizeAttribute } from '../claims';
import { pgOrValue } from '../postgrest-filters';
// Evaluate the real Edge function body, replacing only network/import boundaries.
// Fact writers are not paused unless a test says so: the fixture databases
// answer `true` to every rpc, which would otherwise read as "paused".
export function loadProcessor(bindings:Record<string,unknown>, overrides='') {
 bindings={PROFILE_CANONICAL_SCHEMA:{},createNoteAIExecutionDatabase,selectAllRows,sourceIsDataRule:()=>'',
  factWritesPaused:async()=>false,writeFact,suppressionKey,normalizeAttribute,pgOrValue,...bindings};
 const source=readFileSync('supabase/functions/process-note/index.ts','utf8').replace(/^import[\s\S]*?from\s+["'][^"']+["'];\s*/gm,'');
 const code=ts.transpileModule(source+'\n'+overrides+'\nreturn {processInBackground,generateProfileSuggestions,generateMomentSuggestions,verifyRealPeopleWithLLM};',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
 return new Function('exports',...Object.keys(bindings),code)({},...Object.values(bindings));
}
