import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  credits: null as null | Record<string, unknown>,
  isLoading: false,
  toastError: vi.fn(),
}));
vi.mock("../useAICredits", () => ({
  useAICredits: () => ({ credits: state.credits, isLoading: state.isLoading, refetch: vi.fn() }),
}));
vi.mock("@/lib/toast", () => ({ showToast: { error: state.toastError } }));
import { useAICreditsGate, creditsBlockedMessage } from "../useAICreditsGate";

beforeEach(() => {
  state.credits = null;
  state.isLoading = false;
  state.toastError.mockReset();
});

describe("useAICreditsGate", () => {
  it("says why an AI action is blocked when the balance is spent", () => {
    state.credits = { creditsGranted: 100, remainingCredits: 0, periodEnd: "2026-10-15T00:00:00Z" };
    const { result } = renderHook(() => useAICreditsGate());
    expect(result.current.checkCredits()).toBe(false);
    expect(state.toastError).toHaveBeenCalledTimes(1);
    const message = state.toastError.mock.calls[0][0] as string;
    expect(message).toMatch(/^Your AI credits for this period are used up\. They reset on /);
    expect(message).toContain("2026");
  });

  it("says so on a plan with no credits, where the banner stays hidden", () => {
    state.credits = { creditsGranted: 0, remainingCredits: 0, periodEnd: null };
    const { result } = renderHook(() => useAICreditsGate());
    expect(result.current.checkCredits()).toBe(false);
    expect(state.toastError).toHaveBeenCalledWith("Your plan has no AI credits for this period.");
  });

  it("stays quiet when the action is allowed", () => {
    state.credits = { creditsGranted: 100, remainingCredits: 5, periodEnd: "2026-10-15" };
    const { result } = renderHook(() => useAICreditsGate());
    expect(result.current.checkCredits()).toBe(true);
    state.credits = null;
    expect(renderHook(() => useAICreditsGate()).result.current.checkCredits()).toBe(true);
    expect(state.toastError).not.toHaveBeenCalled();
  });

  it("leaves out an unreadable reset date", () => {
    expect(creditsBlockedMessage({ creditsGranted: 10, periodEnd: "soon" }))
      .toBe("Your AI credits for this period are used up.");
  });
});
