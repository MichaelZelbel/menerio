// Diagnostic reproductions of pre-fix behavior, using synthetic data only.
// These assertions document bugs; turn them into correct-behavior tests when fixing.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { transformSync, build } from 'esbuild';
import { QueryClient } from '@tanstack/react-query';

const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');

function queryMock(resolve) {
  return table => {
    const state = { table, action: 'select', filters: {} };
    const q = {
      select(columns) { state.columns = columns; return q; },
      update(values) { state.action = 'update'; state.values = values; return q; },
      delete() { state.action = 'delete'; return q; },
      eq(key, value) { state.filters[key] = value; return q; },
      is(key, value) { state.filters[key] = value; return q; },
      in() { return q; },
      single() { return q; },
      then(ok, fail) { return Promise.resolve().then(() => resolve(state)).then(ok, fail); },
    };
    return q;
  };
}

function loadHandler(path, client, fetch) {
  let handler;
  const source = read(path).replace(/^import \{ createClient \} from [^\n]+\n/m, '');
  const code = transformSync(source, { loader: 'ts', format: 'cjs' }).code;
  vm.runInNewContext(code, {
    createClient: () => client, fetch, Request, Response, URL, console,
    Deno: {
      env: { get: key => ({ SUPABASE_URL: 'https://synthetic.invalid', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service', SUPABASE_ANON_KEY: 'synthetic-anon' })[key] },
      serve: fn => { handler = fn; },
    },
  });
  return handler;
}

// R2: execute the actual auth callback's cache-removal statements.
const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 300000, gcTime: Infinity } } });
queryClient.setQueryData(['contact_group', 'friends'], { user_id: 'account-a', notes: 'Synthetic private group' });
const auth = read('src/contexts/AuthContext.tsx');
const cleanup = auth.match(/const topicQueries = [\s\S]+?queryClient\.removeQueries\(topicQueries\);/);
assert.ok(cleanup);
vm.runInNewContext(transformSync(cleanup[0], { loader: 'ts' }).code, { queryClient, newSession: null });
vm.runInNewContext(transformSync(cleanup[0], { loader: 'ts' }).code, { queryClient, newSession: { user: { id: 'account-b' } } });
let fetchedForB = false;
const leaked = await queryClient.fetchQuery({ queryKey: ['contact_group', 'friends'], queryFn: async () => { fetchedForB = true; return { user_id: 'account-b' }; } });
assert.equal(leaked.user_id, 'account-a');
assert.equal(fetchedForB, false);
queryClient.clear();
console.log('R2 reproduced: account B receives account A cached group without fetching.');

// R3: actual handler ignores a failed category move, deletes its source, reports success.
const mergeWrites = [];
const mergeClient = {
  auth: { getUser: async () => ({ data: { user: { id: 'owner' } }, error: null }) },
  from: queryMock(s => {
    if (s.action !== 'select') {
      mergeWrites.push(s);
      if (s.table === 'profile_categories' && s.action === 'update') return { error: { code: '40001', message: 'Synthetic serialization failure' } };
      return { data: null, error: null };
    }
    if (s.table === 'contacts') return { data: { id: s.filters.id, name: s.filters.id, aliases: [], app_mappings: {}, notes: '' }, error: null };
    if (s.table === 'profile_categories') return { data: s.filters.contact_id === 'source' ? [{ id: 'source-category', slug: 'identity' }] : [], error: null };
    return { data: [], error: null };
  }),
};
const merge = loadHandler('supabase/functions/merge-contacts/index.ts', mergeClient);
const mergeResponse = await merge(new Request('https://synthetic.invalid/merge', { method: 'POST', headers: { Authorization: 'Bearer synthetic-user', 'Content-Type': 'application/json' }, body: JSON.stringify({ source_contact_id: 'source', target_contact_id: 'target' }) }));
assert.equal(mergeResponse.status, 200);
assert.equal((await mergeResponse.json()).ok, true);
assert.ok(mergeWrites.some(s => s.table === 'profile_categories' && s.action === 'delete'));
assert.ok(mergeWrites.some(s => s.table === 'contacts' && s.values?.merged_into === 'target'));
console.log('R3 reproduced: failed category move still leads to category deletion and successful merge response. SQL cascade effect is source-reviewed, not simulated here.');

// R4: bundle actual connector, replacing only external services.
const bundle = await build({
  entryPoints: [new URL('src/sync/connector.ts', root).pathname.replace(/^\/([A-Za-z]:)/, '$1')], bundle: true, write: false, platform: 'node', format: 'cjs',
  plugins: [{ name: 'synthetic-services', setup(b) {
    b.onResolve({ filter: /^(@powersync\/web|@\/integrations\/supabase\/client|@\/lib\/note-ai-enrollment|\.\/config)$/ }, args => ({ path: args.path, namespace: 'synthetic' }));
    b.onLoad({ filter: /.*/, namespace: 'synthetic' }, args => ({ contents:
      args.path === '@powersync/web' ? 'export const UpdateType = { PUT: "PUT", PATCH: "PATCH", DELETE: "DELETE" };' :
      args.path.endsWith('/client') ? 'export const supabase = globalThis.fakeSupabase;' :
      args.path.endsWith('note-ai-enrollment') ? 'export const captureNoteWithLexicon = async () => { throw new Error("Unexpected capture"); };' :
      'export const POWERSYNC_URL = "https://synthetic.invalid";', loader: 'js' }));
  } }],
});
const module = { exports: {} };
vm.runInNewContext(bundle.outputFiles[0].text, { module, exports: module.exports, console, fakeSupabase: { from: () => ({ upsert: async () => ({ error: { code: '22P02', message: 'Synthetic invalid UUID' } }) }) } });
let completed = false;
let laterAttempted = false;
const ops = [{ op: 'PUT', table: 'notes', id: 'bad', opData: {} }, { op: 'PUT', table: 'notes', id: 'later', get opData() { laterAttempted = true; return {}; } }];
await assert.rejects(new module.exports.SupabaseConnector().uploadData({ getNextCrudTransaction: async () => ({ crud: ops, complete: async () => { completed = true; } }) }), e => e.code === '22P02');
assert.equal(completed, false);
assert.equal(laterAttempted, false);
console.log('R4 reproduced: 22P02 rethrows and prevents later queued edits from being attempted.');

// R5: actual scheduler reports success when downstream authentication returns 401.
const scheduledWrites = [];
let sentAuthorization;
const scheduler = loadHandler('supabase/functions/github-sync-scheduled/index.ts', {
  from: queryMock(s => {
    if (s.action === 'update') { scheduledWrites.push(s); return { error: null }; }
    return { data: [{ id: 'connection', user_id: 'owner', github_token: 'synthetic-github-token' }], error: null };
  }),
}, async (_url, init) => { sentAuthorization = init.headers.Authorization; return new Response('{"error":"Unauthorized"}', { status: 401 }); });
const scheduledResponse = await scheduler(new Request('https://synthetic.invalid/scheduled', { method: 'POST', headers: { Authorization: 'Bearer synthetic-service' } }));
assert.equal(sentAuthorization, 'Bearer synthetic-github-token');
assert.equal((await scheduledResponse.json()).results[0].success, true);
assert.ok(scheduledWrites[0].values.last_sync_at);
console.log('R5 reproduced: downstream 401 still advances last_sync_at and reports success.');
console.log('Four diagnostic reproductions passed. No network requests or real data writes occurred.');
