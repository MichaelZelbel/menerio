import { describe, expect, it, vi } from "vitest";

const reads = vi.hoisted(() => ({ tables: [] as Array<{ table: string; column: string; value: unknown }> }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => ({
      select: () => ({
        eq: async (column: string, value: unknown) => {
          reads.tables.push({ table, column, value });
          return table === "profile_facts"
            ? { data: null, error: { message: "permission denied" } }
            : { data: [], error: null };
        },
      }),
    }),
  },
}));
vi.mock("@/lib/toast", () => ({ showToast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "user-1" } }) }));
import { fetchAiFootprint } from "../useAiFootprint";

describe("fetchAiFootprint", () => {
  it("fails instead of reporting an empty footprint when a read fails", async () => {
    await expect(fetchAiFootprint("n1")).rejects.toMatchObject({ message: "permission denied" });
  });

  it("reads the facts a note produced from profile_facts by source, and no other fact table", async () => {
    reads.tables = [];
    await fetchAiFootprint("n1").catch(() => undefined);
    expect(reads.tables).toContainEqual({ table: "profile_facts", column: "source_id", value: "n1" });
    expect(new Set(reads.tables.map((r) => r.table))).toEqual(
      new Set(["wiki_page_sources", "profile_facts", "note_connections"]),
    );
  });
});
