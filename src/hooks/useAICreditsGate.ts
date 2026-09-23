import { useCallback } from "react";
import { useAICredits, type AICredits } from "./useAICredits";
import { showToast } from "@/lib/toast";

/** "15 October 2026", or null when the period end is missing or unreadable. */
function formatReset(periodEnd: string | null | undefined): string | null {
  if (!periodEnd) return null;
  const date = new Date(periodEnd);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
}

/** The sentence a blocked AI action shows, so the click never does nothing. */
export function creditsBlockedMessage(credits: Pick<AICredits, "creditsGranted" | "periodEnd">): string {
  const reset = formatReset(credits.periodEnd);
  const when = reset ? ` They reset on ${reset}.` : "";
  return credits.creditsGranted === 0
    ? `Your plan has no AI credits for this period.${when}`
    : `Your AI credits for this period are used up.${when}`;
}

export function useAICreditsGate() {
  const { credits, isLoading, refetch } = useAICredits();

  const checkCredits = useCallback((): boolean => {
    // Fail-open while loading
    if (isLoading) return true;

    // No credits data yet — allow
    if (!credits) return true;

    // Zero-grant plans (free tier with 0 credits) and a spent balance both
    // block. Callers simply return on false, and LowBalanceBanner hides itself
    // for zero-grant plans, so the reason has to be said here or the AI button
    // looks broken.
    if (credits.creditsGranted === 0 || credits.remainingCredits <= 0) {
      showToast.error(creditsBlockedMessage(credits));
      return false;
    }

    return true;
  }, [credits, isLoading]);

  return { checkCredits, credits, isLoading, refetch };
}
