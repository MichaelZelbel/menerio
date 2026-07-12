import { describe, it, expect, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { shouldTouchViewed, shouldTouchLoadedPerson, useDeletePerson } from "../usePeople";

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "user-1" } }),
}));

vi.mock("@/lib/toast", () => ({
  showToast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      delete: () => ({ eq: async () => ({ error: null }) }),
    }),
  },
}));

function createWrapper(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: qc }, children);
}

describe("shouldTouchViewed", () => {
  it("touches when the person has never been viewed", () => {
    expect(shouldTouchViewed(null, new Date("2026-07-11T12:00:00Z"))).toBe(true);
  });

  it("skips when last viewed under 5 minutes ago", () => {
    const lastViewedAt = "2026-07-11T12:00:00Z";
    const now = new Date("2026-07-11T12:04:59Z");
    expect(shouldTouchViewed(lastViewedAt, now)).toBe(false);
  });

  it("touches when last viewed exactly 5 minutes ago", () => {
    const lastViewedAt = "2026-07-11T12:00:00Z";
    const now = new Date("2026-07-11T12:05:00Z");
    expect(shouldTouchViewed(lastViewedAt, now)).toBe(true);
  });

  it("touches when last viewed well over 5 minutes ago", () => {
    const lastViewedAt = "2026-07-11T12:00:00Z";
    const now = new Date("2026-07-11T13:00:00Z");
    expect(shouldTouchViewed(lastViewedAt, now)).toBe(true);
  });

  it("touches when last_viewed_at is an unparseable value", () => {
    expect(shouldTouchViewed("not-a-date", new Date("2026-07-11T12:00:00Z"))).toBe(true);
  });
});

describe("shouldTouchLoadedPerson", () => {
  const now = new Date("2026-07-11T12:00:00Z");

  it("never touches when the row is not loaded yet (empty cache is not 'never viewed')", () => {
    expect(shouldTouchLoadedPerson(undefined, now)).toBe(false);
  });

  it("touches when the loaded row has never been viewed", () => {
    expect(shouldTouchLoadedPerson({ last_viewed_at: null }, now)).toBe(true);
  });

  it("skips when the loaded row was viewed under 5 minutes ago", () => {
    expect(shouldTouchLoadedPerson({ last_viewed_at: "2026-07-11T11:58:00Z" }, now)).toBe(false);
  });

  it("touches when the loaded row was viewed over 5 minutes ago", () => {
    expect(shouldTouchLoadedPerson({ last_viewed_at: "2026-07-11T11:00:00Z" }, now)).toBe(true);
  });

  it("touches when the loaded row's last_viewed_at is undefined (pre-migration cache)", () => {
    expect(shouldTouchLoadedPerson({}, now)).toBe(true);
  });
});

describe("useDeletePerson — cache invalidation", () => {
  it(
    "invalidates BOTH the contacts AND contact_group_memberships caches on success " +
      "(regression: the DB cascades a deleted person's membership rows, but the " +
      "aggregate membership query behind the People tree's group counts never hears " +
      "about it, leaving stale counts for the rest of the 5-minute staleTime/24h persister session)",
    async () => {
      const qc = new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      });
      const invalidateSpy = vi.spyOn(qc, "invalidateQueries");

      const { result } = renderHook(() => useDeletePerson(), {
        wrapper: createWrapper(qc),
      });

      await result.current.mutateAsync("person-1");

      const invalidatedKeys = invalidateSpy.mock.calls.map((call) =>
        JSON.stringify(call[0]?.queryKey),
      );
      expect(invalidatedKeys).toContain(JSON.stringify(["contacts"]));
      expect(invalidatedKeys).toContain(JSON.stringify(["contact_group_memberships"]));
    },
  );
});
