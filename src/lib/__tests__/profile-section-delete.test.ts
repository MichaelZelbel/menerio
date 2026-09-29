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

  it("says in words why a private section with facts was not deleted", async () => {
    const db = createFakeSupabase((q) => {
      if (q.table === "profile_categories" && q.op === "select") return { data: section({ visibility_scope: "private" }) };
      if (q.table === "profile_categories" && q.op === "delete") {
        return { error: { code: "23503", message: "private_section_not_empty: move or remove its facts first" } };
      }
      return undefined;
    });
    const failure = deleteProfileSection(db.client, "k1");
    await expect(failure).rejects.toThrow("A private section that still holds facts cannot be deleted.");
    await expect(failure).rejects.not.toThrow(/private_section_not_empty/);
  });
});
