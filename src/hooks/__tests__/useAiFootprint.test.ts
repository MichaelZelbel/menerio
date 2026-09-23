import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => ({
      select: () => ({
        eq: async () => table === "profile_entries"
          ? { data: null, error: { message: "permission denied" } }
          : { data: [], error: null },
      }),
    }),
  },
}));
vi.mock("@/lib/toast", () => ({ showToast: { error: vi.fn(), success: vi.fn() } }));
import { fetchAiFootprint } from "../useAiFootprint";

describe("fetchAiFootprint", () => {
  it("fails instead of reporting an empty footprint when a read fails", async () => {
    await expect(fetchAiFootprint("n1")).rejects.toMatchObject({ message: "permission denied" });
  });
});
