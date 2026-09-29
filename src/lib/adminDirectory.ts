import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

type AppRole = Database["public"]["Enums"]["app_role"];

/** What the Admin page may know about an account. Nothing the user wrote. */
export interface DirectoryRow {
  id: string;
  display_name: string | null;
  created_at: string;
  role: AppRole | null;
}

export async function fetchUserDirectory(o: {
  search?: string;
  role?: AppRole | null;
  page: number;
  pageSize: number;
}): Promise<{ rows: DirectoryRow[]; total: number }> {
  const { data, error } = await supabase.rpc("admin_user_directory", {
    p_search: o.search?.trim() || null,
    p_role: o.role ?? null,
    p_limit: o.pageSize,
    p_offset: o.page * o.pageSize,
  });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Array<DirectoryRow & { total_count: number }>;
  return {
    rows: rows.map(({ total_count: _total, ...row }) => row),
    total: rows.length ? Number(rows[0].total_count) : 0,
  };
}

export async function fetchUserNames(ids: string[]): Promise<Record<string, string>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return {};
  const { data, error } = await supabase.rpc("admin_user_names", { p_ids: unique });
  if (error) throw new Error(error.message);
  const map: Record<string, string> = {};
  for (const p of (data ?? []) as Array<{ id: string; display_name: string | null }>) {
    map[p.id] = p.display_name || p.id.slice(0, 8);
  }
  return map;
}

export async function fetchAccountCounts(): Promise<{ totalUsers: number; newUsers7d: number; paidUsers: number }> {
  const { data, error } = await supabase.rpc("admin_account_counts");
  if (error) throw new Error(error.message);
  const row = ((data ?? []) as Array<{ total_users: number | string; new_users_7d: number | string; paid_users: number | string }>)[0];
  return {
    totalUsers: Number(row?.total_users ?? 0),
    newUsers7d: Number(row?.new_users_7d ?? 0),
    paidUsers: Number(row?.paid_users ?? 0),
  };
}
