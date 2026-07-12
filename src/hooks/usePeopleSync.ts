import { useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useGitHubConnection } from "@/hooks/useGitHubSync";
import {
  requestEntityFileDelete,
  schedulePeopleExport,
} from "@/lib/github-people-sync";

/**
 * People & Groups GitHub mirror triggers. `triggerPeopleSync()` is safe to
 * call from any mutation's onSuccess — it no-ops unless a connection with
 * people sync enabled exists, and debounces into one sweep.
 */
export function usePeopleSync() {
  const { data: connection } = useGitHubConnection();

  const triggerPeopleSync = useCallback(
    (force?: { people?: string[]; groups?: string[] }) => {
      schedulePeopleExport(connection, force);
    },
    [connection],
  );

  const deleteEntityFile = useCallback(
    (entityType: "person" | "group", entityId: string) =>
      requestEntityFileDelete(connection, entityType, entityId),
    [connection],
  );

  return { connection, triggerPeopleSync, deleteEntityFile };
}

/** Full backfill: export every person and group to the vault. */
export function useGitHubPeopleBulkSync() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await supabase.functions.invoke("github-people-sync", {
        body: { bulk: true },
      });
      if (res.error) throw res.error;
      return res.data as {
        success: boolean;
        exported_people: number;
        exported_groups: number;
        retired: number;
        errors: number;
      };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["github-sync-log"] });
      qc.invalidateQueries({ queryKey: ["github-sync-stats"] });
      qc.invalidateQueries({ queryKey: ["github-sync-activity"] });
    },
  });
}
