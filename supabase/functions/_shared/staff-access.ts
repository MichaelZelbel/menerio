/**
 * Record a staff or system action on someone else's account.
 *
 * Fail closed: this throws when the row cannot be written, and every caller
 * records BEFORE it acts, so an action that is not in the user's log did not
 * happen. Only ids and a fixed action word go in; the log must never become a
 * copy of anyone's content (see private.staff_access_log).
 */
export type StaffActorKind = "admin" | "system" | "shared_key";

export interface StaffAccessEntry {
  subjectUserId: string;
  actorUserId: string | null;
  actorKind: StaffActorKind;
  action: string;
  noteId?: string | null;
}

interface RpcLike {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ error: { message: string } | null }>;
}

export async function recordStaffAccess(db: RpcLike, e: StaffAccessEntry): Promise<void> {
  if (!/^[a-z_]{3,40}$/.test(e.action)) throw new Error(`invalid staff action: ${e.action}`);
  const { error } = await db.rpc("record_staff_access", {
    p_subject: e.subjectUserId,
    p_actor: e.actorUserId,
    p_actor_kind: e.actorKind,
    p_action: e.action,
    p_note_id: e.noteId ?? null,
  });
  if (error) throw new Error(`staff access not recorded: ${error.message}`);
}
