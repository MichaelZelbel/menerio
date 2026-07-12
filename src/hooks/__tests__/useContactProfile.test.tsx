import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "user-1" } }),
}));

vi.mock("@/lib/toast", () => ({
  showToast: { success: vi.fn(), error: vi.fn() },
}));

// Minimal chainable supabase mock: list queries resolve empty, mutations
// succeed. Only the shapes useContactProfile actually calls are implemented.
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            order: async () => ({ data: [], error: null }),
          }),
        }),
      }),
      insert: async () => ({ error: null }),
      update: () => ({ eq: async () => ({ error: null }) }),
      delete: () => ({ eq: async () => ({ error: null }) }),
    }),
  },
}));

import { useContactProfile } from "../useContactProfile";

function createWrapper(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

describe("useContactProfile — upsertEntry cache invalidation", () => {
  it(
    "invalidates BOTH the entries AND categories caches on success " +
      "(regression: quick-add into a not-yet-materialized category left the " +
      "stale categories cache hiding the new section)",
    async () => {
      const qc = new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      });
      const invalidateSpy = vi.spyOn(qc, "invalidateQueries");

      const { result } = renderHook(() => useContactProfile("contact-1"), {
        wrapper: createWrapper(qc),
      });

      await result.current.upsertEntry.mutateAsync({
        category_id: "cat-new",
        label: "Karaoke",
        value: "absolutely loves karaoke nights",
      });

      const invalidatedKeys = invalidateSpy.mock.calls.map((call) =>
        JSON.stringify(call[0]?.queryKey),
      );
      expect(invalidatedKeys).toContain(
        JSON.stringify(["contact-profile-entries", "user-1", "contact-1"]),
      );
      expect(invalidatedKeys).toContain(
        JSON.stringify(["contact-profile-categories", "user-1", "contact-1"]),
      );
    },
  );
});
