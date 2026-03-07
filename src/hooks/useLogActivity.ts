import { useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

interface QueuedEvent {
  actor_id: string;
  action: string;
  item_type: string;
  item_id?: string | null;
  metadata?: Record<string, unknown>;
}

const BATCH_DELAY = 1000;

export function useLogActivity() {
  const { user } = useAuth();
  const queueRef = useRef<QueuedEvent[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(async () => {
    const batch = queueRef.current.splice(0);
    if (batch.length === 0) return;
    await supabase.from("activity_events" as any).insert(batch);
  }, []);

  const logActivity = useCallback(
    (
      action: string,
      itemType: string,
      itemId?: string | null,
      metadata?: Record<string, unknown>
    ) => {
      if (!user) return;
      queueRef.current.push({
        actor_id: user.id,
        action,
        item_type: itemType,
        item_id: itemId ?? null,
        metadata: metadata ?? {},
      });
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(flush, BATCH_DELAY);
    },
    [user, flush]
  );

  return { logActivity };
}
