import { describe, expect, it } from 'vitest';
import {
  eligibleAt, recordEdit, completeGeneration, normalizeNoteText, automaticSpacingMs,
  QUIET_MS, CONTINUOUS_EDIT_CAP_MS, FIRST_RUN_QUIET_MS,
} from '../note-ai-policy';

describe('cosmetic edits do not make a new revision', () => {
  it('ticking a checkbox leaves the normalized text unchanged', () => {
    const before = '- [ ] call the bank\n- [ ] write\n\n* [ ] nested\n1. [ ] numbered';
    const after = '- [x] call the bank\n- [X] write\n\n* [x] nested\n1. [x] numbered';
    expect(normalizeNoteText(after)).toBe(normalizeNoteText(before));
  });
  it('line endings, trailing spaces and extra blank lines are not content', () => {
    const clean = 'first line\nsecond line\n\nthird';
    expect(normalizeNoteText('first line   \r\nsecond line\r\n\r\n\r\n\r\nthird\n\n')).toBe(clean);
    expect(normalizeNoteText('\n\nfirst line\nsecond line\n\nthird')).toBe(clean);
    expect(normalizeNoteText('first line\t\nsecond line\n\nthird')).toBe(clean);
  });
  it('a real sentence is a real change', () => {
    expect(normalizeNoteText('- [ ] call the bank\nDone at noon.')).not.toBe(normalizeNoteText('- [x] call the bank'));
    expect(normalizeNoteText('plan a')).not.toBe(normalizeNoteText('plan b'));
  });
  it('is stable and total', () => {
    expect(normalizeNoteText(null)).toBe('');
    expect(normalizeNoteText(undefined)).toBe('');
    expect(normalizeNoteText('  ')).toBe('');
    const text = '- [x] a\n- [ ] b';
    expect(normalizeNoteText(normalizeNoteText(text))).toBe(normalizeNoteText(text));
  });
  it('a checkbox tick recorded as an edit is a no-op for the queue', () => {
    const first = recordEdit(null, normalizeNoteText('- [ ] a'), 0);
    expect(recordEdit(first, normalizeNoteText('- [x] a'), 60_000)).toBe(first);
  });
});

describe('durable note scheduling', () => {
  it('waits ten minutes after the last relevant edit', () => {
    expect(QUIET_MS).toBe(600_000);
    expect(eligibleAt({ firstDirtyAt: 0, lastDirtyAt: 120_000 }, 120_000)).toBe(720_000);
  });
  it('a brand-new note is still indexed two minutes after capture', () => {
    expect(FIRST_RUN_QUIET_MS).toBe(120_000);
    const fresh = recordEdit(null, 'captured', 0);
    expect(eligibleAt({ ...fresh }, 0)).toBe(120_000);
    const revised = recordEdit(fresh, 'revised', 60_000);
    expect(eligibleAt({ ...revised }, 60_000)).toBe(660_000);
  });
  it('caps continuous edits at sixty minutes subject to spacing', () => {
    expect(CONTINUOUS_EDIT_CAP_MS).toBe(3_600_000);
    expect(eligibleAt({ firstDirtyAt: 0, lastDirtyAt: 3_590_000 }, 3_590_000)).toBe(3_600_000);
    expect(eligibleAt({ firstDirtyAt: 0, lastDirtyAt: 100, lastAutomaticStart: 500_000 }, 500_000)).toBe(1_100_000);
  });
  it('spaces automatic starts further apart the more a note has already been run today', () => {
    expect(automaticSpacingMs('analysis', 0)).toBe(600_000);
    expect(automaticSpacingMs('analysis', 1)).toBe(1_200_000);
    expect(automaticSpacingMs('analysis', 2)).toBe(2_400_000);
    expect(automaticSpacingMs('analysis', 3)).toBe(4_800_000);
    expect(automaticSpacingMs('analysis', 4)).toBe(7_200_000);
    expect(automaticSpacingMs('analysis', 9)).toBe(7_200_000);
    expect(automaticSpacingMs('lexicon', 0)).toBe(3_600_000);
    expect(automaticSpacingMs('lexicon', 1)).toBe(7_200_000);
    expect(automaticSpacingMs('lexicon', 3)).toBe(21_600_000);
    expect(automaticSpacingMs('lexicon', 8)).toBe(21_600_000);
    expect(eligibleAt({ firstDirtyAt: 0, lastDirtyAt: 100, lastAutomaticStart: 0, automaticRunsToday: 2 }, 100)).toBe(2_400_000);
    expect(eligibleAt({ firstDirtyAt: 0, lastDirtyAt: 100, lastAutomaticStart: 0, pipeline: 'lexicon' }, 100)).toBe(3_600_000);
  });
  it('manual requests bypass quiet time, never leases or no-credit parking', () => {
    expect(eligibleAt({ firstDirtyAt: 0, lastDirtyAt: 100, manual: true }, 100)).toBe(100);
    expect(eligibleAt({ firstDirtyAt: 0, lastDirtyAt: 100, manual: true, parkedUntil: 500 }, 100)).toBe(500);
    expect(eligibleAt({ firstDirtyAt: 0, lastDirtyAt: 100, manual: true, leaseExpiresAt: 600 }, 100)).toBe(600);
  });
  it('duplicate requests preserve timing and new edits preserve unacknowledged work', () => {
    const first = recordEdit(null, 'one', 0);
    expect(recordEdit(first, 'one', 90_000)).toBe(first);
    const next = recordEdit(first, 'two', 100_000);
    expect(next.firstDirtyAt).toBe(0);
    expect(completeGeneration(next, first.generation)).toBe('pending');
    expect(completeGeneration(next, next.generation)).toBe('completed');
  });
  it.each(['analysis', 'lexicon'])('settles a two-minute editing replay once for %s', () => {
    let state = recordEdit(null, '0', 0);
    let runs = 0;
    for (let t = 0; t <= 900_000; t += 1000) {
      if (t <= 120_000 && t % 20_000 === 0) state = recordEdit(state, String(t), t);
      if (!runs && t >= eligibleAt(state, t)) { runs++; expect(state.lastDirtyAt).toBe(120_000); expect(t).toBe(720_000); }
    }
    expect(runs).toBe(1);
  });
  it('a day of real edits costs a handful of runs, not one per pause', () => {
    // A sentence every five minutes for eight hours, the shape of a journal kept open all day.
    let state = recordEdit(null, '0', 0);
    let pending = true;
    const starts: number[] = [];
    for (let t = 0; t <= 12 * 3_600_000; t += 1000) {
      if (t <= 8 * 3_600_000 && t % 300_000 === 0) {
        // A completed job restarts its dirty window but keeps counting revisions, as the SQL does.
        state = recordEdit(pending ? state : { ...state, firstDirtyAt: t }, String(t), t); pending = true;
      }
      const lastStart = starts.at(-1);
      const runsToday = starts.filter((s) => s > t - 24 * 3_600_000).length;
      if (pending && t >= eligibleAt({ ...state, lastAutomaticStart: lastStart, automaticRunsToday: runsToday }, t)) {
        starts.push(t); pending = false;
      }
    }
    expect(starts.length).toBeGreaterThan(1);
    expect(starts.length).toBeLessThanOrEqual(8);
    starts.slice(1).forEach((t, i) => expect(t - starts[i]).toBeGreaterThanOrEqual(600_000));
    // The final revision is still processed, at most two hours after the last edit.
    expect(pending).toBe(false);
    expect(starts.at(-1)! - 8 * 3_600_000).toBeLessThanOrEqual(7_200_000);
    expect(state.fingerprint).toBe(String(8 * 3_600_000));
  });
});
