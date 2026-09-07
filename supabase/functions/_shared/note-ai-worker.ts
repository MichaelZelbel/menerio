export interface WorkerJob {
  id: string;
  user_id: string;
  note_id: string;
  pipeline: "analysis" | "lexicon";
  lease_id: string;
}

export interface DrainOptions {
  enabled: boolean;
  claim: () => Promise<WorkerJob | null>;
  dispatch: (job: WorkerJob) => Promise<{ status: number; finished?: boolean }>;
  fail: (job: WorkerJob, kind: "transient" | "uncertain" | "permanent" | "no_credit") => Promise<unknown>;
  now?: () => number;
  budgetMs?: number;
}

export async function drainNoteAiJobs(options: DrainOptions) {
  const report = { claimed: 0, finished: 0, accepted: 0, failed: 0, elapsedMs: 0 };
  if (!options.enabled) return report;
  const now = options.now ?? Date.now;
  const startedAt = now();
  let admissions = 0;
  async function slot() {
    // Reserve 110s for the last HTTP execution and margin under the 150s limit.
    while (admissions < 10 && now() - startedAt < (options.budgetMs ?? 25_000)) {
      admissions++;
      const job = await options.claim();
      if (!job) return;
      report.claimed++;
      let result: Awaited<ReturnType<DrainOptions["dispatch"]>>;
      try {
        result = await options.dispatch(job);
      } catch {
        // A transport failure does not prove the executor never contacted AI.
        await options.fail(job, "uncertain");
        report.failed++;
        return;
      }
      if (result.status === 202 || result.status === 409) {
        // A replay can find this lease already executing. Do not revoke the
        // first executor's lease or admit more work into its occupied slot.
        report.accepted++;
        return;
      }
      if (result.status === 200 && result.finished) {
        report.finished++;
      } else {
        const kind = result.status === 402 ? "no_credit"
          : result.status === 401 || result.status === 403 || result.status === 400 ? "permanent"
          : result.status === 503 ? "transient" : "uncertain";
        await options.fail(job, kind);
        report.failed++;
        if (kind === "uncertain") return;
      }
    }
  }
  await Promise.all([slot(), slot()]);
  report.elapsedMs = now() - startedAt;
  return report;
}
