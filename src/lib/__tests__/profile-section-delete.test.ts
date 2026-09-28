import { describe, expect, it } from "vitest";
import { createFakeSupabase, filterValue } from "@/test/fake-supabase";
import { deleteProfileSection } from "../profile-section-delete";

const section = (over: Record<string, unknown> = {}) =>
  ({ id: "k1", user_id: "u1", contact_id: "p1", slug: "hobbies", visibility_scope: "all", ...over });

describe("deleteProfileSection", () => {
  it("moves the section's facts to Other before deleting it", async () => {
    const db = createFakeSupabase((q) => (q.table === "profile_categories" && q.op === "select" ? { data: section() } : undefined));
    await deleteProfileSection(db.client, "k1");
    const ops = db.queries.map((q) => `${q.table}:${q.op}`);
    expect(ops).toEqual(["profile_categories:select", "fact_slots:update", "profile_categories:delete"]);
    const move = db.queries[1];
    expect(move.payload).toEqual({ category_slug: null });
    expect(filterValue(move, "eq", "category_slug")).toBe("hobbies");
    expect(filterValue(move, "eq", "subject_id")).toBe("p1");
  });

  it("never moves a private section's facts: the database refuses the delete instead", async () => {
    const db = createFakeSupabase((q) => (q.table === "profile_categories" && q.op === "select" ? { data: section({ visibility_scope: "private" }) } : undefined));
    await deleteProfileSection(db.client, "k1");
    expect(db.queries.some((q) => q.table === "fact_slots")).toBe(false);
  });
});
