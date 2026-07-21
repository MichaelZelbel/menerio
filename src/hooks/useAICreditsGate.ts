import { useCallback } from "react";
import { useAICredits } from "./useAICredits";

export function useAICreditsGate() {
  const { credits, isLoading, refetch } = useAICredits();

  const checkCredits = useCallback((): boolean => {
    // Fail-open while loading
    if (isLoading) return true;

    // No credits data yet — allow
    if (!credits) return true;

    // Zero-grant plans (free tier with 0 credits) — block
    if (credits.creditsGranted === 0) {
      return false;
    }

    if (credits.remainingCredits <= 0) {
      return false;
    }

    return true;
  }, [credits, isLoading]);

  return { checkCredits, credits, isLoading, refetch };
}
