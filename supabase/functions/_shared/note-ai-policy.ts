/** Pure millisecond policy. The SQL queue implements the same values. */

/** Quiet time after the last relevant edit before an automatic run. */
export const QUIET_MS = 600_000;
/** A brand-new note is indexed this soon after capture; quiet time is for revisions. */
export const FIRST_RUN_QUIET_MS = 120_000;
/** While a note keeps changing, run at the latest this long after the first change. */
export const CONTINUOUS_EDIT_CAP_MS = 3_600_000;

export type NoteAIPipeline = 'analysis' | 'lexicon';

/**
 * Gap between automatic starts of one note/pipeline. It doubles with every run
 * already completed in the last 24 hours, so a note kept open all day settles
 * into a few runs instead of one per pause. Manual requests ignore it.
 */
export function automaticSpacingMs(pipeline: NoteAIPipeline = 'analysis', runsToday = 0): number {
  const base = pipeline === 'lexicon' ? 3_600_000 : 600_000;
  const cap = pipeline === 'lexicon' ? 21_600_000 : 7_200_000;
  return Math.min(cap, base * 2 ** Math.max(0, Math.min(runsToday, 10)));
}

export interface ScheduleInput {
  firstDirtyAt: number;
  lastDirtyAt: number;
  lastAutomaticStart?: number | null;
  automaticRunsToday?: number;
  pipeline?: NoteAIPipeline;
  /** Revision number; the first one is a fresh capture. */
  generation?: number;
  manual?: boolean;
  parkedUntil?: number | null;
  leaseExpiresAt?: number | null;
}
export function eligibleAt(input: ScheduleInput, now: number): number {
  const automatic = Math.max(
    Math.min(input.lastDirtyAt + ((input.generation ?? 2) <= 1 ? FIRST_RUN_QUIET_MS : QUIET_MS), input.firstDirtyAt + CONTINUOUS_EDIT_CAP_MS),
    input.lastAutomaticStart == null ? -Infinity : input.lastAutomaticStart + automaticSpacingMs(input.pipeline, input.automaticRunsToday),
  );
  return Math.max(input.manual ? now : automatic, input.parkedUntil ?? -Infinity, input.leaseExpiresAt ?? -Infinity);
}

/**
 * What the fingerprint sees of a note body. Ticking a checkbox, a Windows line
 * ending, a trailing space or an extra blank line is not new content, and each
 * of them used to buy the whole pipeline again (a checklist ticked through one
 * day cost 17 runs on 2026-09-10). The SQL twin is public.note_ai_normalize_text.
 */
export function normalizeNoteText(text: string | null | undefined): string {
  return (text ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/(^|\n)([ \t]*(?:[-*+]|\d+[.)])[ \t]+)\[[xX ]\]/g, '$1$2[ ]')
    .replace(/[ \t]+(\n|$)/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
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
