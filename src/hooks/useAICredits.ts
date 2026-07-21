import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { onCreditsChange } from "@/lib/credits-events";

export interface AICredits {
  tokensGranted: number;
  tokensUsed: number;
  remainingTokens: number;
  creditsGranted: number;
  creditsUsed: number;
  remainingCredits: number;
  periodStart: string;
  periodEnd: string;
  rolloverTokens: number;
  baseTokens: number;
  tokensPerCredit: number;
}

export function useAICredits() {
  const { session, user } = useAuth();
  const [credits, setCredits] = useState<AICredits | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchCredits = useCallback(async () => {
    if (!session || !user) {
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      setError(null);

      // Ensure allowance period exists. If the Edge Function is temporarily unavailable,
      // keep the UI usable and fall back to reading any existing allowance below.
      const { error: ensureErr } = await supabase.functions.invoke("ensure-token-allowance", {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      if (ensureErr) {
        console.warn("Unable to ensure AI allowance period:", ensureErr);
      }

      // Fetch current allowance from view
      const { data, error: fetchErr } = await supabase
        .from("v_ai_allowance_current" as any)
        .select("*")
        .eq("user_id", user.id)
        .order("period_start", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (fetchErr) throw new Error(fetchErr.message);

      if (data) {
        const meta = (data as any).metadata || {};
        const c: AICredits = {
          tokensGranted: Number((data as any).tokens_granted) || 0,
          tokensUsed: Number((data as any).tokens_used) || 0,
          remainingTokens: Number((data as any).remaining_tokens) || 0,
          creditsGranted: Number((data as any).credits_granted) || 0,
          creditsUsed: Number((data as any).credits_used) || 0,
          remainingCredits: Number((data as any).remaining_credits) || 0,
          periodStart: (data as any).period_start,
          periodEnd: (data as any).period_end,
          rolloverTokens: Number(meta.rollover_tokens) || 0,
          baseTokens: Number(meta.base_tokens) || 0,
          tokensPerCredit: Number(meta.tokens_per_credit) || 200,
        };
        setCredits(c);
      } else {
        setCredits(null);
      }
    } catch (err: any) {
      setError(err.message || "Failed to fetch credits");
    } finally {
      setIsLoading(false);
    }
  }, [session, user]);

  useEffect(() => {
    fetchCredits();
  }, [fetchCredits]);

  // Listen for credit-change events dispatched after AI operations
  useEffect(() => {
    return onCreditsChange(() => {
      fetchCredits();
    });
  }, [fetchCredits]);

  return { credits, isLoading, error, refetch: fetchCredits };
}
