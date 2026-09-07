import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { retryLexiconEnrollments } from "@/lib/note-ai-enrollment";
import { useAuth } from "@/contexts/AuthContext";

const SWEEP_INTERVAL_MS = 5 * 60_000;

/**
 * Server-side safety net for AI note processing.
 *
 * Note writes queue work transactionally. This cheap reconciliation repairs
 * missed enrollment requests after reconnect; it never dispatches paid work.
 * Repeated requests leave the server's quiet period and cooldown unchanged.
 */
export function useProcessingSweep() {
  const { user, session } = useAuth();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!user || !session) return;
    let cancelled = false;

    const run = async () => {
      try {
        await retryLexiconEnrollments(user.id);
        if (cancelled) return;
        const { data, error } = await supabase.functions.invoke("sweep-note-processing", {
          body: { limit: 10 },
        });
        if (cancelled || error) return;
        if (data) {
          // Acceptance means queued, not completed. Read the actual job state.
          queryClient.invalidateQueries({ queryKey: ["note-ai-state"] });
        }
      } catch {
        // Non-critical background maintenance — stay silent.
      }
    };

    const startTimer = setTimeout(run, 5_000);
    const interval = setInterval(run, SWEEP_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearTimeout(startTimer);
      clearInterval(interval);
    };
  }, [user, session, queryClient]);
}
