import { beforeEach, describe, expect, it, vi } from "vitest";
import { filterValue, type createFakeSupabase } from "@/test/fake-supabase";

const fake = vi.hoisted(() => ({ current: null as ReturnType<typeof createFakeSupabase> | null }));
const claims = vi.hoisted(() => ({ rows: [] as any[] }));

vi.mock("@/integrations/supabase/client", async () => {
  const { createFakeSupabase } = await import("@/test/fake-supabase");
  fake.current = createFakeSupabase((q) => {
    if (q.table === "claims" && q.op === "select") return { data: claims.rows };
    if (q.table === "claims" && q.op === "delete") return { data: [{ id: filterValue(q, "eq", "id") }] };
    return undefined;
  });
  return { supabase: fake.current.client };
});
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "user-1" } }) }));

import { FactNotRevertible, factRevertBlockReason, itemClaimIds, revertFactItem } from "../review-fact-revert";

const claim = (id: string, value: string, rank = "normal") => ({
  id, subject_type: "contact", subject_id: "p1", attribute: "languages", value, rank,
});

beforeEach(() => {
  fake.current!.reset();
  claims.rows = [];
});

describe("review queue: rolling back an applied profile fact", () => {
  it("deletes every claim a split value wrote, each after its suppression row", async () => {
    claims.rows = [claim("c1", "German"), claim("c2", "English")];
    await revertFactItem({ target_entity_id: "c1", target_entity_type: "claim", payload: { claim_ids: ["c1", "c2"] } });

    const [read] = fake.current!.on("claims", "select");
    expect(filterValue(read, "in", "id")).toEqual(["c1", "c2"]);
    expect(fake.current!.queries.map((q) => `${q.table}:${q.op}`)).toEqual([
      "claims:select",
      "ai_suggestion_suppressions:upsert",
      "claims:delete",
      "ai_suggestion_suppressions:upsert",
      "claims:delete",
    ]);
    expect(fake.current!.on("ai_suggestion_suppressions").map((q) => (q.payload as any).suppression_key)).toEqual([
      "contact:p1:languages:german",
      "contact:p1:languages:english",
    ]);
  });

  it("refuses items the switch marked not revertible, or whose entry was missing", async () => {
    for (const fact_store_switch of [{ revertible: false }, { entry_missing: true, revertible: false }]) {
      const item = { target_entity_id: "c1", target_entity_type: "claim", payload: { fact_store_switch } };
      expect(factRevertBlockReason(item)).toBeTruthy();
      await expect(revertFactItem(item)).rejects.toBeInstanceOf(FactNotRevertible);
    }
    expect(fake.current!.queries).toEqual([]);
  });

  it("refuses an item that does not point at a claim", async () => {
    await expect(
      revertFactItem({ target_entity_id: "e1", target_entity_type: "profile_entry", payload: {} }),
    ).rejects.toBeInstanceOf(FactNotRevertible);
  });

  it("refuses when the user has made one of the claims their own (rank preferred)", async () => {
    claims.rows = [claim("c1", "German"), claim("c2", "English", "preferred")];
    await expect(
      revertFactItem({ target_entity_id: "c1", target_entity_type: "claim", payload: { claim_ids: ["c2"] } }),
    ).rejects.toBeInstanceOf(FactNotRevertible);
    expect(fake.current!.on("claims", "delete")).toHaveLength(0);
    expect(fake.current!.on("ai_suggestion_suppressions")).toHaveLength(0);
  });

  it("does nothing for an item that wrote nothing", async () => {
    await revertFactItem({ target_entity_id: null, target_entity_type: null, payload: null });
    expect(fake.current!.queries).toEqual([]);
    expect(itemClaimIds({ target_entity_id: "a", target_entity_type: "claim", payload: { claim_ids: ["a", "b"] } })).toEqual(["a", "b"]);
  });
});
