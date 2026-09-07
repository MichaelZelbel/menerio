import { describe, expect, it, vi } from "vitest";
import { drainNoteAiJobs } from "../note-ai-worker";

describe("note AI worker admission", () => {
  it.each([[401, "permanent"], [402, "no_credit"], [503, "transient"], [500, "uncertain"], [200, "uncertain"]] as const)("releases HTTP %s claims as %s without declaring success", async (status, kind) => {
    let next = 0;
    const fail = vi.fn();
    const report = await drainNoteAiJobs({
      enabled: true,
      claim: async () => next++ < 1 ? ({ id: "job", user_id: "fixture", note_id: "note", pipeline: "analysis", lease_id: "lease" }) : null,
      dispatch: async () => ({ status }), fail,
    });
    expect(report).toMatchObject({ claimed: 1, failed: 1, finished: 0 });
    expect(fail).toHaveBeenCalledWith(expect.objectContaining({ id: "job" }), kind);
  });
  it("stops admitting delayed work after the edge budget", async () => {
    vi.useFakeTimers();
    let next = 0;
    const run = drainNoteAiJobs({
      enabled: true,
      claim: async () => ({ id: String(next++), user_id: "fixture", note_id: "note", pipeline: "analysis", lease_id: "lease" }),
      dispatch: async () => { await new Promise((resolve) => setTimeout(resolve, 70_000)); return { status: 200, finished: true }; },
      fail: vi.fn(),
    });
    await vi.runAllTimersAsync();
    expect(await run).toMatchObject({ claimed: 2, finished: 2, elapsedMs: 70_000 });
    vi.useRealTimers();
  });
  it.each([202, 409])("leaves accepted or already-running HTTP %s leases alone without declaring completion", async (status) => {
    const fail = vi.fn();
    const claim = vi.fn(async () => ({ id: "id", user_id: "fixture", note_id: "note", pipeline: "analysis" as const, lease_id: "lease" }));
    const report = await drainNoteAiJobs({ enabled: true, claim, dispatch: async () => ({ status }), fail });
    expect(report).toMatchObject({ claimed: 2, accepted: 2, finished: 0 });
    expect(fail).not.toHaveBeenCalled();
  });
  it("parks uncertain dispatch outcomes instead of making an immediate paid retry", async () => {
    let next = 0;
    const fail = vi.fn();
    const report = await drainNoteAiJobs({
      enabled: true,
      claim: async () => next++ < 2 ? ({ id: String(next), user_id: "fixture", note_id: "note", pipeline: "analysis", lease_id: "lease" }) : null,
      dispatch: async () => { throw new Error("connection lost after send"); },
      fail,
    });
    expect(report.failed).toBe(2);
    expect(fail.mock.calls.map((c) => c[1])).toEqual(["uncertain", "uncertain"]);
  });
  it("does not claim or dispatch while disabled", async () => {
    const claim = vi.fn();
    const dispatch = vi.fn();
    const report = await drainNoteAiJobs({ enabled: false, claim, dispatch, fail: vi.fn() });
    expect(report.claimed).toBe(0);
    expect(claim).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });
  it("drains ten jobs with at most two delayed executions", async () => {
    vi.useFakeTimers();
    let active = 0;
    let peak = 0;
    let next = 0;
    const result = drainNoteAiJobs({
      enabled: true,
      budgetMs: 120_000,
      claim: async () => ({ id: String(next++), user_id: "fixture", note_id: "note", pipeline: "analysis", lease_id: "lease" }),
      dispatch: async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 20_000));
        active--;
        return { status: 200, finished: true };
      },
      fail: vi.fn(),
    });
    await vi.runAllTimersAsync();
    expect(await result).toMatchObject({ claimed: 10, finished: 10, elapsedMs: 100_000 });
    expect(peak).toBe(2);
    vi.useRealTimers();
  });
});
