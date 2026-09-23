import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { retryLexiconEnrollments } from "@/lib/note-ai-enrollment";
import { useAuth } from "@/contexts/AuthContext";

const SWEEP_INTERVAL_MS = 5 * 60_000;

// When this page last swept, per account. DashboardLayout is mounted by three
// separate route trees (/dashboard, /collections, /lexicon), so moving between
// them remounts this hook; so did every hourly token refresh, because the
// effect depended on the session object. Each remount fired a sweep 5 s later.
const lastSweepAt = new Map<string, number>();

/** Test hook: forget when each account last swept. */
export function resetProcessingSweepClock() {
  lastSweepAt.clear();
}

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
  const userId = user?.id;
  const signedIn = !!session;

  useEffect(() => {
    if (!userId || !signedIn) return;
    let cancelled = false;

    const run = async () => {
      // A hidden tab has nobody waiting on the result; the next visible tick
      // (or the next mount) repairs anything missed.
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      const last = lastSweepAt.get(userId) ?? 0;
      if (Date.now() - last < SWEEP_INTERVAL_MS / 2) return;
      lastSweepAt.set(userId, Date.now());
      try {
        await retryLexiconEnrollments(userId);
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
  }, [userId, signedIn, queryClient]);
}
