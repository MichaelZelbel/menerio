import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { createFakeSupabase } from "@/test/fake-supabase";

const fake = vi.hoisted(() => ({ current: null as ReturnType<typeof createFakeSupabase> | null }));

vi.mock("@/integrations/supabase/client", async () => {
  const { createFakeSupabase } = await import("@/test/fake-supabase");
  fake.current = createFakeSupabase();
  return { supabase: fake.current.client };
});
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "user-1" } }) }));
vi.mock("@/lib/toast", () => ({ showToast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/hooks/usePeopleSync", () => ({ usePeopleSync: () => ({ triggerPeopleSync: vi.fn() }) }));

import { useContactProfile } from "../useContactProfile";

function createWrapper(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => fake.current!.reset());

describe("useContactProfile: a person's sections only", () => {
  it("reads the person's sections and nothing else on open: no entries, no adoption, no backfill", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderHook(() => useContactProfile("contact-1"), { wrapper: createWrapper(qc) });
    await waitFor(() => expect(fake.current!.queries.length).toBeGreaterThan(0));
    expect(fake.current!.queries.map((q) => q.table)).toEqual(["profile_categories"]);
    expect(fake.current!.invocations).toEqual([]);
  });

  it("refreshes the facts too when a section changes (its name and scope reach them through the view)", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const spy = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useContactProfile("contact-1"), { wrapper: createWrapper(qc) });

    await result.current.deleteCategory.mutateAsync("cat-1");

    const keys = spy.mock.calls.map((call) => JSON.stringify(call[0]?.queryKey));
    expect(keys).toContain(JSON.stringify(["contact-profile-categories", "user-1", "contact-1"]));
    expect(keys).toContain(JSON.stringify(["profile-facts"]));
  });
});
