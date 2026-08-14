import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

const SWEEP_INTERVAL_MS = 5 * 60_000;

/**
 * Server-side safety net for AI note processing.
 *
 * The editor's auto-process timer is best-effort: navigating away or closing
 * the tab drops it. This asks the `sweep-note-processing` edge function to pick
 * up any note that has content but was never indexed. `process-note` is
 * idempotent per content version, so repeated sweeps never re-spend credits.
 */
export function useProcessingSweep() {
  const { user, session } = useAuth();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!user || !session) return;
    let cancelled = false;

    const run = async () => {
      try {
        const { data, error } = await supabase.functions.invoke("sweep-note-processing", {
          body: { limit: 10 },
        });
        if (cancelled || error) return;
        if ((data as { triggered?: number } | null)?.triggered) {
          // Give the background runs a moment, then refresh the notes list.
          setTimeout(() => {
            if (!cancelled) queryClient.invalidateQueries({ queryKey: ["notes"] });
          }, 20_000);
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
