import { drainNoteAiJobs, type WorkerJob } from "./note-ai-worker.ts";

interface WorkerDependencies {
  authorized: (request: Request) => Promise<boolean>;
  settings: () => Promise<{ enabled: boolean; user_ids: string[] | null } | null>;
  rpc: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  execute: (job: WorkerJob) => Promise<{ status: number; finished?: boolean }>;
  background?: (execution: Promise<Response>) => void;
}

export function createNoteAiWorkerHandler(deps: WorkerDependencies) {
  return async (request: Request): Promise<Response> => {
    if (!await deps.authorized(request)) return Response.json({ error: "Unauthenticated" }, { status: 401 });
    try {
      const config = await deps.settings();
      if (!config?.enabled || config.user_ids?.length === 0) return Response.json({ disabled: true });
      // Rotate the allowlist start each minute, including when it exceeds a batch.
      const users = config.user_ids;
      let cursor = users ? Math.floor(Date.now() / 60_000) % users.length : 0;
      const execution = drainNoteAiJobs({
        enabled: true,
        claim: async () => {
          for (let tries = 0; tries < (users?.length ?? 1); tries++) {
            const userId = users ? users[cursor++ % users.length] : null;
            const rows = await deps.rpc("claim_note_ai_jobs", { _limit: 1, _lease_seconds: 300, _user_id: userId }) as WorkerJob[];
            if (rows?.[0]) return rows[0];
          }
          return null;
        },
        dispatch: deps.execute,
        fail: (job, kind) => deps.rpc("fail_note_ai_job", {
          _user_id: job.user_id, _job_id: job.id, _lease_id: job.lease_id, _kind: kind,
        }),
      }).then((report) => Response.json(report)).catch(() =>
        Response.json({ error: "Note AI worker database unavailable" }, { status: 503 }));
      if (deps.background) {
        deps.background(execution);
        return Response.json({ accepted: true }, { status: 202 });
      }
      return await execution;
    } catch {
      // Never return a normal empty queue for a failed database read.
      return Response.json({ error: "Note AI worker database unavailable" }, { status: 503 });
    }
  };
}
