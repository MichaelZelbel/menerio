/** Pure millisecond policy. The SQL queue implements the same values. */
export interface ScheduleInput {
  firstDirtyAt: number;
  lastDirtyAt: number;
  lastAutomaticStart?: number | null;
  manual?: boolean;
  parkedUntil?: number | null;
  leaseExpiresAt?: number | null;
}
export function eligibleAt(input: ScheduleInput, now: number): number {
  const automatic = Math.max(
    Math.min(input.lastDirtyAt + 120_000, input.firstDirtyAt + 900_000),
    input.lastAutomaticStart == null ? -Infinity : input.lastAutomaticStart + 600_000,
  );
  return Math.max(input.manual ? now : automatic, input.parkedUntil ?? -Infinity, input.leaseExpiresAt ?? -Infinity);
}

export interface DirtyRevision extends ScheduleInput { fingerprint: string; generation: number }
/** Unchanged enqueue is a true no-op, including the original quiet deadline. */
export function recordEdit(previous: DirtyRevision | null, fingerprint: string, now: number): DirtyRevision {
  if (previous?.fingerprint === fingerprint) return previous;
  return { firstDirtyAt: previous?.firstDirtyAt ?? now, lastDirtyAt: now, fingerprint, generation: (previous?.generation ?? 0) + 1 };
}
export function completeGeneration(current: DirtyRevision, captured: number): 'pending' | 'completed' {
  return current.generation === captured ? 'completed' : 'pending';
}
