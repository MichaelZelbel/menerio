import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

// Topic lifecycle now lives inside the merge transaction. Real lock ordering,
// rollback and both race orders are exercised in scripts/test-merge-review.mjs.
function mergeFixture(code: string, message: string) {
  const rpc = vi.fn(async () => ({ data: null, error: { code, message } }));
  const from = vi.fn(() => { throw new Error('Merge must not perform separate REST writes'); });
  const db = { auth: { getUser: async () => ({ data: { user: { id: 'synthetic-owner' } }, error: null }) }, rpc, from };
  let handler: (request: Request) => Promise<Response>;
  const source = readFileSync('supabase/functions/merge-contacts/index.ts','utf8').replace(/^import .*;\r?\n/gm,'');
  const compiled = ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  new Function('Deno','createClient','console',compiled)(
    { env: { get: () => 'synthetic' }, serve: (fn: typeof handler) => { handler=fn; } }, () => db, { error: vi.fn() },
  );
  return { rpc, from, run: (body: unknown) => handler(new Request('https://synthetic.invalid',{method:'POST',headers:{Authorization:'Bearer synthetic'},body:JSON.stringify(body)})) };
}

describe('contact topic atomic merge',()=>{
  it('returns a conflict when self merge has topics',async()=>{
    const f=mergeFixture('PT409','Reassign conversation topics before merging into yourself');
    const response=await f.run({request_id:'retry',source_contact_id:'synthetic-source',merge_into_self:true});
    expect(response.status).toBe(409); expect((await response.json()).code).toBe('PT409'); expect(f.from).not.toHaveBeenCalled();
  });
  it('returns validation failure for a person merge to the same ID',async()=>{
    const f=mergeFixture('22023','Invalid merge request');
    expect((await f.run({request_id:'retry',source_contact_id:'synthetic-source',target_contact_id:'synthetic-source'})).status).toBe(400);
    expect(f.from).not.toHaveBeenCalled();
  });
  it('delegates lifecycle locking and the marker to one transaction',async()=>{
    const f=mergeFixture('PT409','Concurrent topic requires reassignment');
    expect((await f.run({request_id:'retry',source_contact_id:'synthetic-source',merge_into_self:true})).status).toBe(409);
    expect(f.rpc).toHaveBeenCalledExactlyOnceWith('merge_contacts_atomic',{p_request_id:'retry',p_source_contact_id:'synthetic-source',p_target_contact_id:null,p_merge_into_self:true});
    expect(f.from).not.toHaveBeenCalled();
  });
  it('reports a failed transaction without leaving a separate reservation write',async()=>{
    const f=mergeFixture('XX000','Synthetic interruption');
    const response=await f.run({request_id:'retry',source_contact_id:'synthetic-source',merge_into_self:true});
    expect(response.status).toBe(500); expect((await response.json()).error).toContain('retry this request'); expect(f.from).not.toHaveBeenCalled();
  });
});

