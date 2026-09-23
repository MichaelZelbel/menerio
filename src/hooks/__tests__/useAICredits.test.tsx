import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  reads: [] as Array<(row: Record<string, unknown> | null) => void>,
  invokes: 0,
  auth: { user: { id: "u1" }, session: { access_token: "t" } },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => state.auth }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: async () => { state.invokes += 1; return { error: null }; } },
    from: () => {
      const query = {
        select: () => query, eq: () => query, order: () => query, limit: () => query,
        // Each read stays open until the test answers it, in any order.
        maybeSingle: () => new Promise((resolve) => {
          state.reads.push((row) => resolve({ data: row, error: null }));
        }),
      };
      return query;
    },
  },
}));
import { useAICredits } from "../useAICredits";
import { triggerCreditsRefresh } from "@/lib/credits-events";

const row = (remaining: number) => ({ remaining_credits: remaining, credits_granted: 100, metadata: {} });

beforeEach(() => { state.reads = []; state.invokes = 0; });

describe("useAICredits", () => {
  it("keeps the newest balance when an older refresh answers last", async () => {
    const { result } = renderHook(() => useAICredits());
    await waitFor(() => expect(state.reads).toHaveLength(1));
    act(() => triggerCreditsRefresh());
    await waitFor(() => expect(state.reads).toHaveLength(2));

    await act(async () => { state.reads[1](row(10)); });
    await waitFor(() => expect(result.current.credits?.remainingCredits).toBe(10));
    // The first request was sent before the latest deduction; it must not win.
    await act(async () => { state.reads[0](row(50)); });
    expect(state.reads).toHaveLength(2);
    expect(result.current.credits?.remainingCredits).toBe(10);
    expect(result.current.isLoading).toBe(false);
  });

  it("does not call ensure-token-allowance when this month's row is there", async () => {
    const { result } = renderHook(() => useAICredits());
    await waitFor(() => expect(state.reads).toHaveLength(1));
    const future = new Date(Date.now() + 86_400_000).toISOString();
    await act(async () => { state.reads[0]({ ...row(40), period_end: future }); });
    await waitFor(() => expect(result.current.credits?.remainingCredits).toBe(40));
    expect(state.invokes).toBe(0);
    expect(state.reads).toHaveLength(1);
  });

  it("creates the month's row when there is none, then reads it", async () => {
    const { result } = renderHook(() => useAICredits());
    await waitFor(() => expect(state.reads).toHaveLength(1));
    await act(async () => { state.reads[0](null); });
    await waitFor(() => expect(state.reads).toHaveLength(2));
    expect(state.invokes).toBe(1);
    await act(async () => { state.reads[1](row(25)); });
    await waitFor(() => expect(result.current.credits?.remainingCredits).toBe(25));
  });

  it("creates a new row when the one found belongs to a period that has ended", async () => {
    renderHook(() => useAICredits());
    await waitFor(() => expect(state.reads).toHaveLength(1));
    const past = new Date(Date.now() - 86_400_000).toISOString();
    await act(async () => { state.reads[0]({ ...row(5), period_end: past }); });
    await waitFor(() => expect(state.invokes).toBe(1));
  });
});
