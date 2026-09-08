import { describe, it, expect, vi, beforeEach } from "vitest";
import { createElement, type ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { usePeople, usePerson, flattenContactPages, updateContactCache, type Person } from "../usePeople";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "owner" } }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: mocks }));
vi.mock("@/hooks/usePeopleSync", () => ({ usePeopleSync: () => ({}) }));
vi.mock("@/lib/toast", () => ({ showToast: {} }));
const person = (id: string, name = "Duplicate") => ({ id, name } as Person);
function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children);
}
beforeEach(() => vi.clearAllMocks());
describe("contact pagination", () => {
  it.each([0, 1, 3, 4, 11])("retrieves %i contacts when a server returns only 3 per page", async (count) => {
    const rows = Array.from({ length: count }, (_, i) => person(String(i).padStart(3, "0")));
    mocks.rpc.mockImplementation((_fn, args) => ({ abortSignal: async () => {
      const start = args.after_id ? rows.findIndex(p => p.id === args.after_id) + 1 : 0;
      const batch = rows.slice(start, start + 3);
      return { data: { rows: batch, total: count, next: start + 3 < count ? batch.at(-1) : null }, error: null };
    }}));
    const { result } = renderHook(() => usePeople(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    while (result.current.hasNextPage) await act(async () => { await result.current.fetchNextPage(); });
    expect(result.current.data.map(p => p.id)).toEqual(rows.map(p => p.id));
    expect(result.current.total).toBe(count);
    expect(mocks.rpc.mock.calls.every(([name]) => name === "search_contacts_page")).toBe(true);
  });
  it("starts a new server search instead of filtering downloaded rows", async () => {
    mocks.rpc.mockImplementation((_fn, args) => ({ abortSignal: async () => ({
      data: { rows: [person(args.search_text || "first-page")], total: 1, next: null }, error: null,
    }) }));
    const { result, rerender } = renderHook(({ search }) => usePeople(search), { initialProps: { search: "" }, wrapper: wrapper() });
    await waitFor(() => expect(result.current.data[0]?.id).toBe("first-page"));
    rerender({ search: "far-away-alias" });
    await waitFor(() => expect(result.current.data[0]?.id).toBe("far-away-alias"));
    expect(mocks.rpc.mock.calls.at(-1)?.[1]).toMatchObject({ search_text: "far-away-alias", after_id: null });
  });
  it("deduplicates contacts renamed beyond the cursor during loading", () => {
    const rows = flattenContactPages([{ rows: [person("a", "A")], total: 1, next: null }, { rows: [person("a", "Z")], total: 1, next: null }]);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("Z");
  });
  it("updates paginated and detail caches without losing the next cursor", () => {
    const cursor = { id: "a", name: "A" };
    const page = { pages: [{ rows: [person("a"), person("b")], total: 3, next: cursor }], pageParams: [null] };
    const updated = updateContactCache(page, "a", { is_favorite: true }) as typeof page;
    expect(updated.pages[0].rows[0].is_favorite).toBe(true);
    expect(updated.pages[0].rows[1]).toBe(page.pages[0].rows[1]);
    expect(updated.pages[0].next).toEqual(cursor);
    expect((updateContactCache(person("a"), "a", { is_favorite: true }) as Person).is_favorite).toBe(true);
  });
  it("loads a deep-linked contact independently of the list page", async () => {
    const query: any = { select: vi.fn(() => query), eq: vi.fn(() => query), is: vi.fn(() => query), abortSignal: vi.fn(() => query), maybeSingle: async () => ({ data: person("distant"), error: null }) };
    mocks.from.mockReturnValue(query);
    const { result } = renderHook(() => usePerson("distant"), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.data?.id).toBe("distant"));
    expect(query.eq).toHaveBeenCalledWith("id", "distant");
    expect(query.eq).toHaveBeenCalledWith("user_id", "owner");
  });
});
