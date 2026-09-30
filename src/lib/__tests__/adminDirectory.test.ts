import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));

import { fetchAccountCounts, fetchUserDirectory, fetchUserNames } from "@/lib/adminDirectory";

beforeEach(() => rpc.mockReset());

describe("fetchUserDirectory", () => {
  it("passes paging and filters and splits the total off the rows", async () => {
    rpc.mockResolvedValue({ data: [{ id: "u1", display_name: "Bea", created_at: "2026-09-01", role: "free", total_count: 42 }], error: null });
    const res = await fetchUserDirectory({ search: "  bea ", role: "free", page: 2, pageSize: 10 });
    expect(rpc).toHaveBeenCalledWith("admin_user_directory", { p_search: "bea", p_role: "free", p_limit: 10, p_offset: 20 });
    expect(res).toEqual({ rows: [{ id: "u1", display_name: "Bea", created_at: "2026-09-01", role: "free" }], total: 42 });
  });

  it("sends nulls for an empty search and no role", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    const res = await fetchUserDirectory({ search: "  ", role: null, page: 0, pageSize: 10 });
    expect(rpc).toHaveBeenCalledWith("admin_user_directory", { p_search: null, p_role: null, p_limit: 10, p_offset: 0 });
    expect(res).toEqual({ rows: [], total: 0 });
  });

  it("throws the database error", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "admin only" } });
    await expect(fetchUserDirectory({ page: 0, pageSize: 10 })).rejects.toThrow("admin only");
  });
});

describe("fetchUserNames", () => {
  it("returns an empty map without calling the database for no ids", async () => {
    expect(await fetchUserNames([])).toEqual({});
    expect(rpc).not.toHaveBeenCalled();
  });

  it("de-duplicates ids and falls back to a short id for a missing name", async () => {
    rpc.mockResolvedValue({ data: [{ id: "abcdef123456", display_name: null }], error: null });
    expect(await fetchUserNames(["abcdef123456", "abcdef123456"])).toEqual({ abcdef123456: "abcdef12" });
    expect(rpc).toHaveBeenCalledWith("admin_user_names", { p_ids: ["abcdef123456"] });
  });
});

describe("fetchAccountCounts", () => {
  it("maps the row to numbers", async () => {
    rpc.mockResolvedValue({ data: [{ total_users: "12", new_users_7d: 3, paid_users: 2 }], error: null });
    expect(await fetchAccountCounts()).toEqual({ totalUsers: 12, newUsers7d: 3, paidUsers: 2 });
  });
});
