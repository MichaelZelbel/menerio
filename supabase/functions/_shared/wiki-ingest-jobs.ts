import { NoteAIJobError, classifyNoteAIError, createNoteAIJobs, type NoteAILease } from "./note-ai-jobs.ts";

export type WikiJob = { user_id: string; id: string; lease_id: string; note_id?: string; snapshot?: any; pipeline?: string };
type RpcClient = { rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: any; error: any }> };

/**
 * The status wiki-ingest answers the drain worker with when a job ends in an
 * error. drainNoteAiJobs (note-ai-worker.ts) reads a 500 as "uncertain": it
 * files that on the job and closes its slot for the tick. wiki-ingest answered
 * 500 for every failure, so an exhausted allowance (a plain INSUFFICIENT_CREDITS
 * Error from runChat, already parked by the endpoint) closed a worker slot on
 * each hourly retry, 126 times on 2026-09-29, and a transient lease-RPC failure
 * raised before the job was touched was fenced for good as "uncertain".
 * The same statuses process-note answers since 2026-09-23.
 */
export function wikiIngestErrorStatus(error: unknown): 402 | 409 | 422 | 500 | 503 {
  if (!(error instanceof NoteAIJobError) && classifyNoteAIError(error) !== 'no_credit') return 500;
  return ({ no_credit: 402, transient: 503, stale: 409, permanent: 422, uncertain: 500 } as const)[classifyNoteAIError(error)];
}

export async function runWikiStage<T>(db: RpcClient, job: WikiJob, stage: string, produce: () => Promise<T>): Promise<T> {
  // Shared runtime owns the lease, stage start, and checkpoint protocol.
  const result = await createNoteAIJobs(db).runStage(job as NoteAILease, stage, async () => {
    try { return await produce(); } catch (error) {
      if (classifyNoteAIError(error) === 'no_credit' || error instanceof NoteAIJobError) throw error;
      // Refused before the provider was ever reached: nothing was paid, so a
      // retry is the right answer, not a terminal "uncertain" that fenced the
      // stage for good after one unreadable allowance view.
      if (error instanceof Error && ['BALANCE_UNAVAILABLE', 'REPEAT_CALL_BLOCKED'].includes(error.message)) {
        throw new NoteAIJobError('transient', error.message);
      }
      throw new NoteAIJobError('uncertain', 'Provider result unavailable');
    }
  });
  if (result === undefined || result === null) throw new NoteAIJobError('permanent', 'stage_not_reusable');
  return result;
}


export async function dispatchWikiRequest(token: string, body: any, deps: {
  serviceToken: string;
  authenticate: (token: string) => Promise<string | null>;
  jobs: Pick<ReturnType<typeof createNoteAIJobs>, 'enqueue' | 'getLease' | 'claimExecution'>;
  execute: (job: any) => Promise<any>;
}) {
  if (deps.serviceToken && token === deps.serviceToken) {
    const job = await deps.jobs.getLease(body.user_id, body.job_id, body.lease_id);
    if (!job || job.user_id !== body.user_id || job.note_id !== body.note_id || job.pipeline !== 'lexicon') {
      return { status: 409, body: { error: 'Invalid lease' } };
    }
    if (!await deps.jobs.claimExecution(job)) {
      return { status: 409, body: { error: 'Execution already admitted' } };
    }
    return { status: 200, body: await deps.execute(job) };
  }
  const userId = await deps.authenticate(token);
  if (!userId) return { status: 401, body: { error: 'Unauthenticated' } };
  await deps.jobs.enqueue(userId, body.note_id, 'lexicon', 'automatic');
  return { status: 202, body: { accepted: true, queued: true, note_id: body.note_id } };
}
