import { supabase } from "@/integrations/supabase/client";
import type { GitHubConnection } from "@/hooks/useGitHubSync";

/**
 * Debounced trigger for the People & Groups GitHub mirror.
 *
 * Unlike notes (which export per-save), people/groups changes trigger a
 * server-side diff sweep: contacts are also written by edge functions, so the
 * sweep — not the client — decides what actually needs exporting. Force hints
 * cover hard deletes (removed memberships, deleted facts), which leave no
 * updated_at trace for the sweep's dirty detection.
 */

const DEBOUNCE_MS = 3000;

let timer: ReturnType<typeof setTimeout> | null = null;
let pendingPeople = new Set<string>();
let pendingGroups = new Set<string>();

/** Pure gate — exported for tests. */
export function shouldSyncPeople(connection: GitHubConnection | null | undefined): boolean {
  if (!connection) return false;
  if (!connection.sync_enabled || !connection.repo_owner || !connection.repo_name) return false;
  if (connection.sync_people === false) return false;
  return connection.sync_direction === "export" || connection.sync_direction === "bidirectional";
}

export function schedulePeopleExport(
  connection: GitHubConnection | null | undefined,
  force?: { people?: string[]; groups?: string[] },
): void {
  if (!shouldSyncPeople(connection)) return;

  for (const id of force?.people || []) pendingPeople.add(id);
  for (const id of force?.groups || []) pendingGroups.add(id);

  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    const body: Record<string, unknown> = { sweep: true };
    if (pendingPeople.size > 0) body.force_people = [...pendingPeople];
    if (pendingGroups.size > 0) body.force_groups = [...pendingGroups];
    pendingPeople = new Set();
    pendingGroups = new Set();
    supabase.functions.invoke("github-people-sync", { body }).catch((err) => {
      console.warn("People sync sweep failed:", err);
    });
  }, DEBOUNCE_MS);
}

/**
 * Delete an entity's mirrored file. Call BEFORE deleting the entity from the
 * DB (the sync log still knows the file path then). Returns the group ids
 * whose member tables need a refresh once the delete lands — pass them back
 * via schedulePeopleExport({ groups }). Best-effort: the sweep's retire pass
 * is the backstop if this call fails.
 */
export async function requestEntityFileDelete(
  connection: GitHubConnection | null | undefined,
  entityType: "person" | "group",
  entityId: string,
): Promise<string[]> {
  if (!shouldSyncPeople(connection)) return [];
  try {
    const { data } = await supabase.functions.invoke("github-people-sync", {
      body: { action: "delete", entity_type: entityType, entity_id: entityId },
    });
    return (data?.affected_group_ids as string[]) || [];
  } catch (err) {
    console.warn("People sync file delete failed:", err);
    return [];
  }
}
