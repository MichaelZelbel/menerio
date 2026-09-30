import { describe, expect, it } from "vitest";
import { recordStaffAccess } from "../staff-access.ts";

function fakeDb(error: { message: string } | null = null) {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  return {
    calls,
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      return { error };
    },
  };
}

describe("recordStaffAccess", () => {
  it("sends ids and the action word to record_staff_access", async () => {
    const db = fakeDb();
    await recordStaffAccess(db, { subjectUserId: "u1", actorUserId: "a1", actorKind: "admin", action: "reanalyze_note", noteId: "n1" });
    expect(db.calls).toEqual([{ fn: "record_staff_access", args: { p_subject: "u1", p_actor: "a1", p_actor_kind: "admin", p_action: "reanalyze_note", p_note_id: "n1" } }]);
  });

  it("sends a null note id when none is given", async () => {
    const db = fakeDb();
    await recordStaffAccess(db, { subjectUserId: "u1", actorUserId: null, actorKind: "system", action: "delete_account" });
    expect(db.calls[0].args.p_note_id).toBeNull();
  });

  it("throws when the database refuses, so the caller does not act", async () => {
    const db = fakeDb({ message: "boom" });
    await expect(recordStaffAccess(db, { subjectUserId: "u1", actorUserId: "a1", actorKind: "admin", action: "reanalyze_note" })).rejects.toThrow("staff access not recorded: boom");
  });

  it("refuses an action that is not a plain word, before calling the database", async () => {
    const db = fakeDb();
    await expect(recordStaffAccess(db, { subjectUserId: "u1", actorUserId: "a1", actorKind: "admin", action: "read: secret" })).rejects.toThrow("invalid staff action");
    expect(db.calls).toEqual([]);
  });
});
