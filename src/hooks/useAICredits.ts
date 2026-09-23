import { useState, useEffect, useCallback, useRef } from "react";
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

/** A row whose period has not ended. A row without a readable end counts as current. */
function allowanceIsCurrent(row: unknown): boolean {
  if (!row) return false;
  const end = (row as { period_end?: string | null }).period_end;
  if (!end) return true;
  const t = new Date(end).getTime();
  return Number.isNaN(t) || t > Date.now();
}

export function useAICredits() {
  const { session, user } = useAuth();
  const [credits, setCredits] = useState<AICredits | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Every AI call fires a refresh, so several fetches overlap. Only the newest
  // may write state: an older one that resolved last put back the balance from
  // before the latest deduction, and the credits gate then let calls through
  // on credits that were already spent. Also stops writes after unmount.
  const latestRequest = useRef(0);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const fetchCredits = useCallback(async () => {
    const request = ++latestRequest.current;
    const current = () => mounted.current && request === latestRequest.current;
    if (!session || !user) {
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      setError(null);

      const readAllowance = () =>
        supabase
          .from("v_ai_allowance_current" as any)
          .select("*")
          .eq("user_id", user.id)
          .order("period_start", { ascending: false })
          .limit(1)
          .maybeSingle();

      // Read first; call ensure-token-allowance only when this month's row is
      // missing or over. It used to run before every read, and every mounted
      // copy of this hook (banner, sidebar, Dashboard, editor gate) reads on
      // mount, on each token refresh and after every AI call, so one AI action
      // cost three to four edge-function calls whose answer was "it exists".
      // The function is idempotent, so skipping it when the row is current
      // changes nothing. If it is unavailable, fall back to what exists.
      let { data, error: fetchErr } = await readAllowance();
      if (!fetchErr && !allowanceIsCurrent(data)) {
        const { error: ensureErr } = await supabase.functions.invoke("ensure-token-allowance", {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (ensureErr) {
          console.warn("Unable to ensure AI allowance period:", ensureErr);
        } else {
          ({ data, error: fetchErr } = await readAllowance());
        }
      }

      if (fetchErr) throw new Error(fetchErr.message);
      if (!current()) return;

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
      if (current()) setError(err.message || "Failed to fetch credits");
    } finally {
      if (current()) setIsLoading(false);
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
