import { describe, expect, it } from "vitest";
import {
  actionIsVisible,
  loadMcVisibility,
  noteIsVisible,
  redactContact,
  sensitiveContactExclusion,
  type McVisibility,
} from "../mc-visibility.ts";

const on: McVisibility = { hideSensitive: true, sensitiveIds: new Set(["s1"]) };
const off: McVisibility = { hideSensitive: false, sensitiveIds: new Set(["s1"]) };

describe("mc-visibility", () => {
  it("hides hidden notes always, sensitive-linked ones only with the gate on", () => {
    expect(noteIsVisible({ ai_visibility: "hidden" }, off)).toBe(false);
    expect(noteIsVisible({ ai_visibility: "visible", metadata: { matched_people: ["s1"] } }, on)).toBe(false);
    expect(noteIsVisible({ ai_visibility: "visible", metadata: { matched_people: ["s1"] } }, off)).toBe(true);
    expect(noteIsVisible({ ai_visibility: "visible", metadata: null }, on)).toBe(true);
  });

  it("hides action items that are hidden or about a sensitive person", () => {
    expect(actionIsVisible({ ai_visibility: "hidden", contact_id: null }, on)).toBe(false);
    expect(actionIsVisible({ ai_visibility: "visible", contact_id: "s1" }, on)).toBe(false);
    expect(actionIsVisible({ ai_visibility: "visible", contact_id: "s1" }, off)).toBe(true);
    expect(sensitiveContactExclusion(on)).toBe("contact_id.is.null,contact_id.not.in.(s1)");
    expect(sensitiveContactExclusion(off)).toBeNull();
  });

  it("reduces a sensitive contact to id, name and relationship", () => {
    const row = { id: "s1", name: "S", relationship: "friend", email: "s@example.com", phone: "1" };
    const shown = redactContact(row, on) as Record<string, unknown>;
    expect(shown).toMatchObject({ id: "s1", name: "S", relationship: "friend", is_sensitive: true });
    expect(shown.email).toBeUndefined();
    expect(redactContact(row, off)).toBe(row);
    expect(redactContact({ ...row, id: "other" }, on).email).toBe("s@example.com");
  });

  it("fails closed when the settings cannot be read", async () => {
    const chain = (result: unknown) => {
      const q: Record<string, unknown> = {};
      for (const m of ["select", "eq", "is"]) q[m] = () => q;
      q.maybeSingle = () => Promise.resolve(result);
      q.then = (ok: (v: unknown) => unknown) => Promise.resolve(ok(result));
      return q;
    };
    const db = {
      from: (table: string) =>
        table === "contacts" ? chain({ data: null, error: { message: "timeout" } }) : chain({ data: null, error: null }),
    };
    await expect(loadMcVisibility(db, "u")).rejects.toThrow(/visibility/);
  });
});
