import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

function mergeFixture(topicCount: number, failAfterReservation = false) {
  const writes: string[] = [];
  const db = {
    auth: { getUser: async () => ({ data: { user: { id: 'synthetic-owner' } }, error: null }) },
    from(table: string) {
      if (failAfterReservation && table === 'profile_categories') throw new Error('Synthetic interruption');
      const query: any = {
        select: () => query, eq: () => query, is: () => query,
        single: async () => writes.length && !failAfterReservation ? { data: null, error: new Error('Topic appeared before reservation') } : { data: { id: 'synthetic-source', name: 'Synthetic source' }, error: null },
        update: () => { writes.push(table); return query; },
        insert: () => { writes.push(table); return query; },
        delete: () => { writes.push(table); return query; },
        then: (resolve: (value: unknown) => void) => resolve({ count: topicCount, error: null }),
      };
      return query;
    },
  };
  let handler: (request: Request) => Promise<Response>;
  const source = readFileSync('supabase/functions/merge-contacts/index.ts','utf8').replace(/^import .*;\r?\n/gm,'');
  const code = ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  new Function('Deno','createClient','console',code)(
    { env: { get: () => 'synthetic' }, serve: (fn: typeof handler) => { handler=fn; } },
    () => db, { error: vi.fn() },
  );
  return { writes, run: (body: unknown) => handler(new Request('https://synthetic.invalid',{method:'POST',headers:{Authorization:'Bearer synthetic'},body:JSON.stringify(body)})) };
}

describe('contact topic merge preflight',()=>{
  it('refuses merge into self before any existing profile writes when topics need another person',async()=>{
    const f=mergeFixture(3);
    const response=await f.run({source_contact_id:'synthetic-source',merge_into_self:true});
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({code:'TOPICS_REQUIRE_REASSIGNMENT',topic_count:3});
    expect(f.writes).toEqual([]);
  });
  it('refuses a person merge to the same ID before writes',async()=>{
    const f=mergeFixture(0);
    const response=await f.run({source_contact_id:'synthetic-source',target_contact_id:'synthetic-source'});
    expect(response.status).toBe(400);
    expect(f.writes).toEqual([]);
  });
  it('reserves self merge atomically before profile writes and refuses a late topic',async()=>{
    const f=mergeFixture(0);
    const response=await f.run({source_contact_id:'synthetic-source',merge_into_self:true});
    expect(response.status).toBe(500);
    expect((await response.json()).error).toContain('Topic appeared');
    expect(f.writes).toEqual(['contacts']);
  });
  it('keeps the visible reservation after failure so an overlapping merge cannot admit topics',async()=>{
    const f=mergeFixture(0,true);
    const response=await f.run({source_contact_id:'synthetic-source',merge_into_self:true});
    expect(response.status).toBe(500);
    expect((await response.json()).error).toBe('Synthetic interruption');
    expect(f.writes).toEqual(['contacts']);
  });
});
