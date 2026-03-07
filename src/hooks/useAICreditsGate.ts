import { useCallback } from "react";
import { useAICredits } from "./useAICredits";
import { useToast } from "@/hooks/use-toast";

export function useAICreditsGate() {
  const { credits, isLoading, refetch } = useAICredits();
  const { toast } = useToast();

  const checkCredits = useCallback((): boolean => {
    // Fail-open while loading
    if (isLoading) return true;

    // No credits data yet — allow
    if (!credits) return true;

    // Zero-grant plans (free tier with 0 credits) — block
    if (credits.creditsGranted === 0) {
      toast({
        variant: "destructive",
        title: "No AI credits available",
        description: "Your plan does not include AI credits. Contact an admin or upgrade your plan.",
      });
      return false;
    }

    if (credits.remainingCredits <= 0) {
      toast({
        variant: "destructive",
        title: "Out of AI credits",
        description: "You've used all your AI credits for this period. Contact an admin or wait for the next billing cycle.",
      });
      return false;
    }

    return true;
  }, [credits, isLoading, toast]);

  return { checkCredits, credits, isLoading, refetch };
}
