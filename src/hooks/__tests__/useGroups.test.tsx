import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useGroup, useRestoreGroup, useTrashGroup, useUpdateGroup } from "../useGroups";
import { usePersonGroupMemberships } from "../useGroupMemberships";

type Query = { table: string; select?: string; filters: Array<[string, unknown]>; update?: Record<string, unknown> };

const db = vi.hoisted(() => ({
  queries: [] as Query[],
  rows: {} as Record<string, Record<string, unknown>[]>,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      const query: Query = { table, filters: [] };
      let single = false;
      const result = () => {
        db.queries.push(query);
        const hits = (db.rows[table] ?? [])
          .filter((row) => query.filters.every(([column, value]) => column.includes(".") || row[column] === value))
          .map((row) => ({ ...row, ...query.update }));
        return single ? { data: hits[0] ?? null, error: null } : { data: hits, error: null };
      };
      const chain: Record<string, unknown> = {
        select: (columns: string) => ((query.select = columns), chain),
        update: (values: Record<string, unknown>) => ((query.update = values), chain),
        eq: (column: string, value: unknown) => (query.filters.push([column, value]), chain),
        is: () => chain,
        order: () => chain,
        single: () => ((single = true), chain),
        maybeSingle: () => ((single = true), chain),
        then: (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve),
      };
      return chain;
    },
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));
vi.mock("@/hooks/usePeopleSync", () => ({ usePeopleSync: () => ({ triggerPeopleSync: vi.fn() }) }));
vi.mock("@/lib/toast", () => ({ showToast: { success: vi.fn(), error: vi.fn() } }));

let qc: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;

beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  db.queries = [];
  db.rows = {
    contact_groups: [
      { id: "g-live", user_id: "u1", slug: "investors", is_trashed: false, success_criteria: [] },
      { id: "g-trash", user_id: "u1", slug: "old-club", is_trashed: true, success_criteria: [] },
    ],
  };
});

describe("group hooks", () => {
  it("treats a trashed group as not found", async () => {
    const { result } = renderHook(() => useGroup("old-club"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
    expect(db.queries[0].filters).toContainEqual(["is_trashed", false]);
  });

  it("still finds a live group", async () => {
    const { result } = renderHook(() => useGroup("investors"), { wrapper });
    await waitFor(() => expect(result.current.data?.id).toBe("g-live"));
  });

  it("lists a person's memberships of live groups only", async () => {
    const { result } = renderHook(() => usePersonGroupMemberships("p1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const query = db.queries.find((entry) => entry.table === "contact_group_memberships")!;
    expect(query.select).toContain("contact_groups:group_id!inner(*)");
    expect(query.filters).toContainEqual(["contact_groups.is_trashed", false]);
  });

  it("refreshes people's Groups tabs when a group is trashed or restored", async () => {
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const trash = renderHook(() => useTrashGroup(), { wrapper });
    await trash.result.current.mutateAsync("g-live");
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["person_groups"] });

    invalidate.mockClear();
    const restore = renderHook(() => useRestoreGroup(), { wrapper });
    await restore.result.current.mutateAsync("g-trash");
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["person_groups"] });
  });

  it("puts the saved group in the cache before the save reports done", async () => {
    qc.setQueryData(["contact_group", "investors"], { id: "g-live", slug: "investors", success_criteria: [{ label: "Calls", current: 1 }] });
    const update = renderHook(() => useUpdateGroup(), { wrapper });
    await update.result.current.mutateAsync({ id: "g-live", success_criteria: [{ label: "Calls", current: 2 }] });
    expect(qc.getQueryData<{ success_criteria: unknown }>(["contact_group", "investors"])?.success_criteria).toEqual([
      { label: "Calls", current: 2 },
    ]);
  });
});
