import { pullGithubConnection } from "./github-pull.ts";
import { completeMergeVaultJobs } from "./merge-vault-jobs.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface GithubSyncConnection {
  id: string; user_id: string; sync_people?: boolean; sync_direction: string;
  [key: string]: unknown;
}

/** Called only after the entrypoint verifies a user or scheduler credential. */
export async function runGithubSync(client: SupabaseClient, userId: string, connection: GithubSyncConnection, body: {action?: string; [key: string]: unknown} = {}) {
  if (!userId || connection.user_id !== userId) throw new Error("Connection owner mismatch");
  const leaseId = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  const lease = async (action: string, success = false, error: string | null = null) => {
    const result = await client.rpc("github_sync_lease", { p_connection: connection.id, p_user: userId,
      p_lease: leaseId, p_action: action, p_success: success, p_error: error });
    if (result.error) throw result.error;
    return result.data === true;
  };
  if (!await lease("acquire")) return { success: false, busy: true, error: "Synchronization already running" };
  let lostLease = false;
  const heartbeat = setInterval(() => { void lease("renew").then(ok => { if (!ok) lostLease = true; }).catch(() => { lostLease = true; }); }, 60_000);
  try {
    const response = await pullGithubConnection(client, userId, connection, body);
    const result = await response.json();
    const completedPull = !body.action && response.ok && result.success === true && result.errors === 0 && !lostLease;
    if (completedPull && connection.sync_people !== false && ["export", "bidirectional"].includes(connection.sync_direction)) {
      await completeMergeVaultJobs(client, userId, startedAt);
    }
    if (!await lease("finish", completedPull, completedPull ? null : body.action ? "action_only" : "partial_sync")) throw new Error("Sync lease lost");
    return { ...result, success: !lostLease && response.ok && (body.action ? result.success !== false : completedPull) };
  } catch {
    await lease("finish", false, "sync_failed");
    return { success: false, error: "GitHub synchronization failed; retry the connection" };
  } finally {
    clearInterval(heartbeat);
  }
}
