// Durable orchestration. Authentication belongs to the endpoint; every RPC is tenant scoped.
export interface NoteAILease {
  id: string; user_id: string; note_id: string; pipeline: 'analysis' | 'lexicon';
  lease_id: string; captured_generation: number; desired_generation: number;
  fingerprint: string; snapshot: Record<string, any>;
}
export type NoteAIFailure = 'transient' | 'permanent' | 'no_credit' | 'uncertain' | 'stale';
export class NoteAIJobError extends Error {
  constructor(public kind: NoteAIFailure, message: string) { super(message); this.name = 'NoteAIJobError'; }
}
export function classifyNoteAIError(error: unknown): NoteAIFailure {
  if (error instanceof NoteAIJobError) return error.kind;
  if (error instanceof Error && error.message === 'INSUFFICIENT_CREDITS') return 'no_credit';
  return 'transient';
}
export function createNoteAIJobs(db: { rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{data: any; error: any}> }) {
  async function rpc(name: string, args: Record<string, unknown>) {
    const {data,error} = await db.rpc(name,args);
    if (error) throw new NoteAIJobError('transient', `${name} failed`);
    return data;
  }
  const scope = (lease: NoteAILease) => ({_user_id:lease.user_id,_job_id:lease.id,_lease_id:lease.lease_id});
  async function getLease(userId: string, jobId: string, leaseId: string): Promise<NoteAILease | null> {
    return await rpc('get_note_ai_job_snapshot',{_user_id:userId,_job_id:jobId,_lease_id:leaseId});
  }
  async function assertCurrent(lease: NoteAILease) {
    const live = await getLease(lease.user_id,lease.id,lease.lease_id);
    if (!live || live.captured_generation !== live.desired_generation) throw new NoteAIJobError('stale','Note revision or lease changed');
    return live;
  }
  async function fenced(name: string, lease: NoteAILease, extra = {}) {
    if (!await rpc(name,{...scope(lease),...extra})) throw new NoteAIJobError('stale','Note lease rejected');
  }
  async function runStage<T>(lease: NoteAILease, stage: string, produce: () => Promise<T>, apply?: (result: T) => Promise<unknown>): Promise<T> {
    await assertCurrent(lease);
    const saved = await rpc('begin_note_ai_stage',{...scope(lease),_stage:stage});
    if (!saved || !['started','checkpointed','applied','uncertain'].includes(saved.status)) throw new NoteAIJobError('stale','Stage lease rejected');
    if (saved?.status === 'applied') {
      if (saved.result == null) throw new NoteAIJobError('permanent','Applied stage result was erased');
      return saved.result;
    }
    if (saved?.status === 'uncertain') throw new NoteAIJobError('uncertain',`Uncertain paid stage: ${stage}`);
    let result: T;
    if (saved?.status === 'checkpointed') result = saved.result;
    else {
      try {
        result = await produce();
      } catch (error) {
        if (error instanceof NoteAIJobError || (error instanceof Error && ['INSUFFICIENT_CREDITS','BALANCE_UNAVAILABLE'].includes(error.message))) throw error;
        throw new NoteAIJobError('uncertain',`Provider outcome unknown: ${stage}`);
      }
      try {
        await fenced('checkpoint_note_ai_stage',lease,{_stage:stage,_result:result});
      } catch {
        // The provider answered. Losing that answer must not become a cheap-looking retry.
        throw new NoteAIJobError('uncertain',`Paid checkpoint unavailable: ${stage}`);
      }
    }
    if (apply) {
      await assertCurrent(lease);
      await apply(result);
      await fenced('apply_note_ai_stage',lease,{_stage:stage});
    }
    return result;
  }
  return {
    getLease, assertCurrent, runStage,
    replaceChunks: (lease:NoteAILease,chunks:Record<string,unknown>[]) => fenced("replace_note_ai_chunks",lease,{_chunks:chunks}),
    reanalyze: (userId:string,noteId:string,pipeline:"analysis"|"lexicon") => rpc("reanalyze_note_ai_job",{_user_id:userId,_note_id:noteId,_pipeline:pipeline}),
    claimExecution: async (lease:NoteAILease): Promise<boolean> => (await rpc("claim_note_ai_execution",scope(lease))) === true,
    applyNote: (lease:NoteAILease, output: {metadata?:Record<string,unknown>;embedding?:number[]|null;title?:string|null;processedHash?:string|null;finish?:boolean}) => fenced('apply_note_ai_output',lease,{
      _metadata:output.metadata ?? {},_embedding:output.embedding ?? null,_title:output.title ?? null,
      _processed_hash:output.processedHash ?? null,_finish:output.finish ?? false,
    }),
    enqueue: (userId:string,noteId:string,pipeline:'analysis'|'lexicon',reason:'automatic'|'manual'='automatic') => rpc('enqueue_note_ai_job',{_user_id:userId,_note_id:noteId,_pipeline:pipeline,_reason:reason}),
    finish: (lease:NoteAILease) => fenced('finish_note_ai_job',lease),
    fail: (lease:NoteAILease,kind:NoteAIFailure) => fenced('fail_note_ai_job',lease,{_kind:kind === 'stale' ? 'transient' : kind}),
  };
}
