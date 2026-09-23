import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  reads: [] as Array<(row: Record<string, unknown>) => void>,
  auth: { user: { id: "u1" }, session: { access_token: "t" } },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => state.auth }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: async () => ({ error: null }) },
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

beforeEach(() => { state.reads = []; });

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
});
