import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { selectAllRows } from "./paged-select.ts";

interface MergeVaultJob { id: string; source_contact_id: string; target_contact_id: string | null; created_at: string }
/** A successful sweep may skip conflicts. Acknowledge only proven entity work. */
export async function completeMergeVaultJobs(client: SupabaseClient, userId: string, startedAt: string) {
  const jobs = await selectAllRows<MergeVaultJob>((from, to) => client.from("contact_merge_vault_jobs")
    .select("id,source_contact_id,target_contact_id,created_at").eq("user_id", userId).eq("status", "pending")
    .lte("created_at", startedAt).order("id").range(from, to));
  for (const job of jobs) {
    const source = await client.from("github_sync_log").select("id").eq("user_id", userId)
      .eq("entity_type", "person").eq("entity_id", job.source_contact_id).maybeSingle();
    if (source.error) throw source.error;
    if (source.data) continue;
    if (job.target_contact_id) {
      const target = await client.from("github_sync_log").select("sync_status,synced_at").eq("user_id", userId)
        .eq("entity_type", "person").eq("entity_id", job.target_contact_id).maybeSingle();
      if (target.error) throw target.error;
      if (target.data?.sync_status !== "synced" || !(Date.parse(target.data.synced_at) >= Date.parse(job.created_at))) continue;
    }
    const done = await client.from("contact_merge_vault_jobs").update({ status: "done", completed_at: new Date().toISOString() })
      .eq("id", job.id).eq("user_id", userId).eq("status", "pending");
    if (done.error) throw done.error;
  }
}
