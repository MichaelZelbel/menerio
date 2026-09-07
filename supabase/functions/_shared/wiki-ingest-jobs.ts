import { NoteAIJobError, classifyNoteAIError, createNoteAIJobs, type NoteAILease } from "./note-ai-jobs.ts";

export type WikiJob = { user_id: string; id: string; lease_id: string; note_id?: string; snapshot?: any; pipeline?: string };
type RpcClient = { rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: any; error: any }> };

export async function runWikiStage<T>(db: RpcClient, job: WikiJob, stage: string, produce: () => Promise<T>): Promise<T> {
  // Shared runtime owns the lease, stage start, and checkpoint protocol.
  const result = await createNoteAIJobs(db).runStage(job as NoteAILease, stage, async () => {
    try { return await produce(); } catch (error) {
      if (classifyNoteAIError(error) === 'no_credit' || error instanceof NoteAIJobError) throw error;
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
