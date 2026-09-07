import { describe, expect, it } from 'vitest';
import { eligibleAt, recordEdit, completeGeneration } from '../note-ai-policy';

describe('durable note scheduling', () => {
  it('waits two minutes after the last relevant edit', () => {
    expect(eligibleAt({ firstDirtyAt: 0, lastDirtyAt: 120_000 }, 120_000)).toBe(240_000);
  });
  it('caps continuous edits at fifteen minutes subject to ten-minute spacing', () => {
    expect(eligibleAt({ firstDirtyAt: 0, lastDirtyAt: 890_000 }, 890_000)).toBe(900_000);
    expect(eligibleAt({ firstDirtyAt: 0, lastDirtyAt: 100, lastAutomaticStart: 500_000 }, 500_000)).toBe(1_100_000);
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
    for (let t = 0; t <= 300_000; t += 1000) {
      if (t <= 120_000 && t % 20_000 === 0) state = recordEdit(state, String(t), t);
      if (!runs && t >= eligibleAt(state, t)) { runs++; expect(state.lastDirtyAt).toBe(120_000); }
    }
    expect(runs).toBe(1);
  });
  it('thirty-minute replay spaces starts and eventually completes final revision', () => {
    let state = recordEdit(null, '0', 0);
    let pending = true;
    let lastStart: number | undefined;
    const starts: number[] = [];
    for (let t = 0; t <= 2_500_000; t += 1000) {
      if (t <= 1_800_000 && t % 20_000 === 0) {
        state = recordEdit(pending ? state : null, String(t), t); pending = true;
      }
      if (pending && t >= eligibleAt({ ...state, lastAutomaticStart: lastStart }, t)) {
        starts.push(t); lastStart = t; pending = false;
      }
    }
    expect(starts.length).toBeGreaterThan(1);
    starts.slice(1).forEach((t, i) => expect(t - starts[i]).toBeGreaterThanOrEqual(600_000));
    expect(pending).toBe(false);
    expect(state.fingerprint).toBe('1800000');
  });
});
