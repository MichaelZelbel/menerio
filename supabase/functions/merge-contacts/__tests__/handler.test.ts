// @vitest-environment node
//
// Loads the real edge function into a sandbox and drives its HTTP handler.
//
// The module is transformed to CommonJS and given a `require` shim rather than
// having its import line stripped from the source text. The strip it used to do
// was `source.replace(/^import .*\n/, '')`, which silently did nothing on a
// CRLF checkout — JavaScript's `.` matches no line terminator, and `\r` is one —
// so esbuild emitted a real `require()` call the sandbox had no binding for and
// all eight tests died with "require is not defined". Injecting the dependency
// instead of editing the source keeps this test honest about what deploys, and
// keeps it passing wherever it runs.
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { transformSync } from 'esbuild';
import { describe, expect, it, vi } from 'vitest';
const source = readFileSync('supabase/functions/merge-contacts/index.ts', 'utf8');
function setup(authenticated = true, rpcError: unknown = null) {
 let handler: (request: Request) => Promise<Response>;
 const rpc = vi.fn(async () => ({ data: { ok: true, replayed: false }, error: rpcError }));
 const createClient = vi.fn(() => ({ auth: { getUser: vi.fn(async () => ({ data: { user: authenticated ? { id: 'owner' } : null }, error: null })) }, rpc }));
 const require = (specifier: string) => {
  if (specifier.includes('supabase-js')) return { createClient };
  throw new Error(`unexpected import in merge-contacts: ${specifier}`);
 };
 runInNewContext(transformSync(source, { loader: 'ts', format: 'cjs' }).code, {
  require, createClient, Request, Response, console, Deno: { env: { get: (key: string) => key }, serve: (fn: typeof handler) => { handler = fn; } },
 });
 return { call: (body: unknown, token = 'Bearer good') => handler(new Request('https://example.test', { method: 'POST', headers: token ? { Authorization: token } : {}, body: JSON.stringify(body) })), rpc, createClient };
}
describe('merge endpoint transaction boundary', () => {
 it('rejects missing authentication before database work', async () => {
  const x = setup(); expect((await x.call({}, '')).status).toBe(401); expect(x.createClient).not.toHaveBeenCalled();
 });
 it('rejects an invalid user token', async () => {
  const x = setup(false); expect((await x.call({})).status).toBe(401); expect(x.rpc).not.toHaveBeenCalled();
 });
 it('requires a retry ID', async () => {
  const x = setup(); expect((await x.call({ source_contact_id: 'source' })).status).toBe(400); expect(x.rpc).not.toHaveBeenCalled();
 });
 it('uses caller credentials and one RPC, never service-role table writes', async () => {
  const x = setup(); expect((await x.call({ request_id: 'retry', source_contact_id: 'source', target_contact_id: 'target' })).status).toBe(200);
  expect(x.createClient).toHaveBeenCalledWith('SUPABASE_URL', 'SUPABASE_ANON_KEY', expect.objectContaining({ global: { headers: { Authorization: 'Bearer good' } } }));
  expect(x.rpc).toHaveBeenCalledExactlyOnceWith('merge_contacts_atomic', { p_request_id: 'retry', p_source_contact_id: 'source', p_target_contact_id: 'target', p_merge_into_self: false });
 });
 it.each([['PT409', 409], ['42501', 403], ['22P02', 400], ['XX000', 500]])('does not report success after %s', async (code, status) => {
  const x = setup(true, { code, message: 'private diagnostic' }); const r = await x.call({ request_id: 'retry', source_contact_id: 'source', merge_into_self: true });
  expect(r.status).toBe(status); expect((await r.json()).ok).toBeUndefined(); expect(x.rpc).toHaveBeenCalledTimes(1);
 });
});
