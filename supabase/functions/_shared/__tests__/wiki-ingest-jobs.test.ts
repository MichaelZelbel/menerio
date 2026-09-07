import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { softStructure } from '../wiki-structure';

function endpointFunctions(deps: Record<string, unknown> = {}) {
  const source = readFileSync('supabase/functions/wiki-ingest/index.ts', 'utf8')
    .split('serve(async')[0].replace(/^import .*;$/gm, '').replace(/^const SUPABASE_.*$/gm, '');
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  return new Function('softStructure', ...Object.keys(deps), code + '; return { processIngest, synthesizeGroupInsights, mergeWithProtectedSections, validateAction };')(softStructure, ...Object.values(deps));
}

it.each([false, true])('uses captured input and handles an uncertain final checkpoint: %s', async (uncertain) => {
  const stages = new Map<string, unknown>();
  const inserts: any[] = [];
  const rpc = vi.fn(async (name: string, args: any) => {
    if (name === 'begin_note_ai_stage' && args._stage === 'wiki-apply' && uncertain) return { data: {status:'uncertain'},error:null };
    if (name === 'begin_note_ai_stage') return { data: stages.has(args._stage) ? { status: 'checkpointed', result: stages.get(args._stage) } : { status: 'started' }, error: null };
    if (name === 'checkpoint_note_ai_stage') stages.set(args._stage, args._result);
    return { data: true, error: null };
  });
  const from = vi.fn((table: string) => {
    if (table === 'notes') throw new Error('must use immutable snapshot');
    const q: any = { select: () => q, eq: () => q, order: () => q, insert: (row: any) => { inserts.push(row); return q; }, then: (done: any) => done({ data: [], error: null }) };
    return q;
  });
  const runChat = vi.fn(async () => ({ content: JSON.stringify({ actions: [], source_links: [], log_summary: 'fixture' }) }));
  const finish = vi.fn(async () => true);
  const jobs = { assertCurrent: vi.fn(), finish };
  const { processIngest } = endpointFunctions({ runChat, runWikiStage, NoteAIJobError, WIKI_INGEST_PROMPT: 'fixture', shouldExtractFacts: (source: string) => source !== 'hub' });
  const job = { id: 'j', user_id: 'u', note_id: 'n', lease_id: 'l', fingerprint: 'fixture-fp', snapshot: { id: 'n', title: 'Synthetic fixture', content: 'A sufficiently long synthetic note for testing.', metadata: {}, ai_visibility: 'visible' } };
  if (uncertain) {
    const error = await processIngest({ rpc, from }, jobs, job, Date.now()).catch((e: unknown) => e);
    expect(classifyNoteAIError(error)).toBe('uncertain');
    expect(finish).not.toHaveBeenCalled();
    return;
  }
  await processIngest({ rpc, from }, jobs, job, Date.now());
  expect(runChat).toHaveBeenCalledTimes(1);
  expect(runChat).toHaveBeenCalledWith(expect.objectContaining({ noteId: 'n', jobId: 'j', revision: 'fixture-fp', stage: 'wiki-main' }));
  expect(rpc).toHaveBeenCalledWith('wiki_apply_note_ai_result', { _user_id: 'u', _job_id: 'j', _lease_id: 'l' });
  expect(stages.has('wiki-main')).toBe(true);
  expect(stages.has('wiki-apply')).toBe(true);
  expect(finish).toHaveBeenCalledWith(job);
  expect(inserts[0].details.group_insights).not.toHaveProperty("actions");
});

it('group insight outputs are checkpointed and tenant scoped, never directly written', async () => {
  const pages = { id: 'p', slug: 'group-fixture', title: 'Fixture', content: '## Purpose\nUser purpose\n\n## Insights\nOld', protected_sections: [], updated_at: 'v1' };
  const scopes: string[] = [];
  const relationScopes: string[] = [];
  const fixtures: Record<string, any> = { contacts: [{ id: 'c' }], contact_group_memberships: [{ contact_id: 'c', contact_groups: { id: 'g', slug: 'fixture', name: 'Fixture' } }], wiki_pages: pages, contact_interactions: [], notes: [] };
  const db = { from: (table: string) => {
    const q: any = { select: () => q, eq: (key: string, value: string) => { if (key === 'user_id' && value === 'u') scopes.push(table); if (key === 'contact_groups.user_id' && value === 'u') relationScopes.push(table); return q; }, in: () => q, is: (key: string) => { if (table === 'notes' && key === 'deleted_at') throw new Error('notes uses is_trashed'); return q; }, gte: () => q, order: () => q, limit: () => q, maybeSingle: () => q, then: (done: any) => done({ data: fixtures[table], error: null }) }; return q;
  }, rpc: vi.fn(async (name: string) => ({ data: name === 'begin_note_ai_stage' ? { status: 'started' } : true, error: null })) };
  const runChat = vi.fn(async () => ({ content: JSON.stringify({ insights: 'Synthetic new insight' }) }));
  const { synthesizeGroupInsights } = endpointFunctions({ runChat, runWikiStage, shouldExtractFacts: () => true });
  const result = await synthesizeGroupInsights(db, 'u', { metadata: { people: ['Fixture'] } }, 'n', 'Fixture context', { id: 'j', user_id: 'u', lease_id: 'l' }, { assertCurrent: vi.fn() });
  expect(result.actions[0].patch).toContain('User purpose');
  expect(result.actions[0].patch).toContain('Synthetic new insight');
  expect(result.actions[0].expected).toEqual(pages);
  expect(scopes.sort()).toEqual(Object.keys(fixtures).sort());
  expect(relationScopes).toEqual(["contact_group_memberships"]);
  expect(db.rpc).toHaveBeenCalledWith('checkpoint_note_ai_stage', expect.objectContaining({ _stage: 'wiki-group:g' }));
});

it.each([{ source_app: 'hub' }, { ai_visibility: 'hidden' }, { is_trashed: true }])('refuses ineligible snapshots before provider access: %j', async (restriction) => {
  const runChat = vi.fn();
  const { processIngest } = endpointFunctions({ runChat, shouldExtractFacts: (source: string) => source !== 'hub' });
  await expect(processIngest({}, { assertCurrent: vi.fn() }, { user_id: 'u', note_id: 'n', snapshot: { title: 'Fixture', content: 'Synthetic long text', ...restriction } }, Date.now())).rejects.toThrow('ineligible');
  expect(runChat).not.toHaveBeenCalled();
});

it('retains protected sections and grounding checks', () => {
  const { mergeWithProtectedSections, validateAction } = endpointFunctions();
  expect(mergeWithProtectedSections('## Purpose\nUser words\n\n## Insights\nOld', '## Purpose\nAI words\n\n## Insights\nNew', ['purpose'])).toContain('User words');
  expect(validateAction({ op: 'update', slug: 'absent', patch: 'Synthetic text '.repeat(20) }, 'Different topic', 'Prior page', 'Absent', new Set()).ok).toBe(false);
});
import { runWikiStage, dispatchWikiRequest } from '../wiki-ingest-jobs';
import { classifyNoteAIError, createNoteAIJobs, NoteAIJobError, type NoteAILease } from '../note-ai-jobs';

it('classifies uncertain paid stages for delayed bounded recovery, not immediate transient retry', async () => {
 const db = { rpc: vi.fn(async () => ({data: {status:'uncertain'}, error:null})) };
 const error = await runWikiStage(db,{user_id:'u',id:'j',lease_id:'l'},'wiki-main',vi.fn()).catch(e=>e);
 expect(classifyNoteAIError(error)).toBe('uncertain');
});

it('ordinary calls only enqueue, while service execution requires an owned live Lexicon lease', async () => {
  const execute = vi.fn(async () => ({ ok: true }));
  const enqueue = vi.fn(async () => ({ id: 'job' }));
  const getLease = vi.fn(async () => null);
  const claimExecution = vi.fn(async () => true);
  const deps = { serviceToken: 'private-service', authenticate: vi.fn(async () => 'u'), jobs: { enqueue, getLease, claimExecution }, execute };
  const body = { note_id: 'n', change_type: 'UPDATE', execute: true, job_id: 'j', lease_id: 'l', user_id: 'u' };
  for (let i = 0; i < 2; i++) {
    const response = await dispatchWikiRequest('user-token', body, deps);
    expect(response.status).toBe(202);
  }
  expect(execute).not.toHaveBeenCalled();
  expect(enqueue).toHaveBeenCalledWith('u', 'n', 'lexicon', 'automatic');
  expect((await dispatchWikiRequest('private-service', body, deps)).status).toBe(409);
  expect(execute).not.toHaveBeenCalled();
  getLease.mockResolvedValueOnce({ user_id: 'other', note_id: 'n', pipeline: 'lexicon' } as never);
  expect((await dispatchWikiRequest('private-service', body, deps)).status).toBe(409);
  getLease.mockResolvedValueOnce({ user_id: 'u', note_id: 'n', pipeline: 'lexicon' } as never);
  expect((await dispatchWikiRequest('private-service', body, deps)).status).toBe(200);
  expect(execute).toHaveBeenCalledTimes(1);
});

it('rejects duplicate execution while a paid stage is pending without revoking the original lease', async () => {
  const job: NoteAILease = { id: 'j', user_id: 'u', note_id: 'n', lease_id: 'l', pipeline: 'lexicon', captured_generation: 1, desired_generation: 1, fingerprint: 'fixture-fp', snapshot: {} };
  let live = true;
  let admitted = false;
  let stage: { status: string; result?: unknown } | undefined;
  const db = { rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
    expect(args).toMatchObject({ _user_id: 'u', _job_id: 'j', _lease_id: 'l' });
    let data: unknown;
    switch (name) {
      case 'get_note_ai_job_snapshot': data = live ? job : null; break;
      case 'claim_note_ai_execution':
        data = live && !admitted;
        if (data) admitted = true;
        break;
      case 'begin_note_ai_stage':
        data = !live ? null : stage?.status === 'started' ? { status: 'busy' } : stage ?? { status: 'started' };
        if (live && !stage) stage = { status: 'started' };
        break;
      case 'checkpoint_note_ai_stage':
        data = live && stage?.status === 'started';
        if (data) stage = { status: 'checkpointed', result: args._result };
        break;
      case 'fail_note_ai_job':
        data = live;
        live = false;
        if (args._kind === 'transient' && stage?.status === 'started') stage = undefined;
        break;
      default: throw new Error(`Unexpected RPC: ${name}`);
    }
    return { data, error: null };
  }) };
  const jobs = createNoteAIJobs(db);
  const fail = vi.spyOn(jobs, 'fail');
  let release!: (result: { raw: string }) => void;
  let entered!: () => void;
  const pending = new Promise<{ raw: string }>((resolve) => { release = resolve; });
  const started = new Promise<void>((resolve) => { entered = resolve; });
  const buy = vi.fn(() => { entered(); return pending; });
  const execute = vi.fn(async (lease: NoteAILease) => {
    // Match the endpoint's failure path, including lease revocation on stale work.
    try { return await runWikiStage(db, lease, 'wiki-main', buy); }
    catch (error) { await jobs.fail(lease, classifyNoteAIError(error)); throw error; }
  });
  const deps = { serviceToken: 'private-service', authenticate: vi.fn(async () => null), jobs, execute };
  const body = { user_id: 'u', note_id: 'n', job_id: 'j', lease_id: 'l' };
  const first = dispatchWikiRequest('private-service', body, deps).catch((error: unknown) => error);
  const paid = { raw: 'paid fixture' };
  try {
    await started;
    const duplicate = await dispatchWikiRequest('private-service', body, deps).catch((error: unknown) => error);
    expect(duplicate).toEqual({ status: 409, body: { error: 'Execution already admitted' } });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(buy).toHaveBeenCalledTimes(1);
    expect(fail).not.toHaveBeenCalled();
    expect(await jobs.assertCurrent(job)).toEqual(job);
    expect(stage).toEqual({ status: 'started' });
  } finally {
    release(paid);
    await first;
  }
  expect(await first).toEqual({ status: 200, body: paid });
  expect(await jobs.assertCurrent(job)).toEqual(job);
  expect(stage).toEqual({ status: 'checkpointed', result: paid });
  expect(await runWikiStage(db, job, 'wiki-main', buy)).toEqual(paid);
  expect(buy).toHaveBeenCalledTimes(1);
  expect(fail).not.toHaveBeenCalled();
});

describe('Lexicon durable stages', () => {
  it.each(['checkpoint-false', 'checkpoint-error', 'provider-timeout'])('parks uncertain paid work after %s', async (failure) => {
    const db = { rpc: vi.fn(async (name: string) => ({data: name === 'begin_note_ai_stage' ? {status:'started'} : name === 'checkpoint_note_ai_stage' && failure === 'checkpoint-false' ? false : true, error: name === 'checkpoint_note_ai_stage' && failure === 'checkpoint-error' ? new Error('fixture db failure') : null})) };
    const error = await runWikiStage(db,{user_id:'u',id:'j',lease_id:'l'},'wiki-main',async () => { if (failure === 'provider-timeout') throw new Error('fixture provider timeout'); return {raw:'paid fixture'}; }).catch(e=>e);
    expect(classifyNoteAIError(error)).toBe('uncertain');
  });
  it('checkpoints paid output before returning it, and refuses uncertain or lost leases', async () => {
    const calls: string[] = [];
    const db = { rpc: vi.fn(async (name: string) => { calls.push(name); return { data: name === 'begin_note_ai_stage' ? { status: 'started' } : true, error: null }; }) };
    const result = { raw: 'test fixture' };
    expect(await runWikiStage(db, { user_id: 'u', id: 'j', lease_id: 'l' }, 'main', async () => { calls.push('provider'); return result; })).toEqual(result);
    expect(calls).toEqual(['get_note_ai_job_snapshot', 'begin_note_ai_stage', 'provider', 'checkpoint_note_ai_stage']);
    for (const state of [null, { status: 'uncertain' }, { status: 'applied' }]) {
      const buy = vi.fn();
      const denied = { rpc: vi.fn(async () => ({ data: state, error: null })) };
      await expect(runWikiStage(denied, { user_id: 'u', id: 'j', lease_id: 'l' }, 'main', buy)).rejects.toThrow();
      expect(buy).not.toHaveBeenCalled();
    }
  });
  it('replays a checkpointed zero-action result without another provider call', async () => {
    const saved = { actions: [], source_links: [], log_summary: 'Nothing new' };
    const db = { rpc: vi.fn(async (name: string) => ({ data: name === 'begin_note_ai_stage' ? { status: 'checkpointed', result: saved } : true, error: null })) };
    const buy = vi.fn();
    expect(await runWikiStage(db, { user_id: 'u', id: 'j', lease_id: 'l' }, 'main', buy)).toEqual(saved);
    expect(buy).not.toHaveBeenCalled();
    expect(db.rpc).toHaveBeenCalledWith('begin_note_ai_stage', { _user_id: 'u', _job_id: 'j', _lease_id: 'l', _stage: 'main' });
  });
});
