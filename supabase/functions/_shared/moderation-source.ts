/**
 * Moderation keeps references, never copies of text.
 *
 * Only a note someone chose to share publicly is ever checked, and the AI
 * review reads it live, at review time, and only while the share is still on.
 * Nothing here stores the text: the admin tables hold ids, matched words and a
 * category, so an admin can never read a note through moderation.
 */
interface Query {
  select(cols: string): Query;
  eq(col: string, val: unknown): Query;
  maybeSingle(): PromiseLike<{ data: Record<string, unknown> | null; error: unknown }>;
}
export interface NoteReaderLike {
  from(table: string): Query;
}

const stripHtml = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

/** The db error's own message, never any note content. */
function errMessage(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) return String((e as { message: unknown }).message);
  return String(e);
}

export async function loadSharedNoteForReview(
  db: NoteReaderLike,
  noteId: string | null,
  userId: string,
): Promise<{ title: string; text: string } | null> {
  if (!noteId) return null;
  const { data: share, error: shareErr } = await db.from("shared_notes").select("note_id")
    .eq("note_id", noteId).eq("user_id", userId).eq("is_active", true).maybeSingle();
  // A failed read must never look like "not shared": that would mark the
  // item skipped forever instead of letting the worker's per-item catch retry it.
  if (shareErr) throw new Error(`could not read shared_notes: ${errMessage(shareErr)}`);
  if (!share) return null;
  const { data: note, error: noteErr } = await db.from("notes").select("title, content")
    .eq("id", noteId).eq("user_id", userId).maybeSingle();
  if (noteErr) throw new Error(`could not read note: ${errMessage(noteErr)}`);
  if (!note) return null;
  const title = String(note.title ?? "").trim() || "Untitled Note";
  const text = stripHtml(`${note.title ?? ""} ${note.content ?? ""}`).slice(0, 5000);
  return { title: title.slice(0, 100), text };
}

export function blockedModerationEvent(a: {
  userId: string; action: string; itemType: string; itemId: string | null;
  matched: string[]; category: string; tier: "stopword" | "ai";
}): Record<string, unknown> {
  return {
    user_id: a.userId, action: a.action, item_type: a.itemType, item_id: a.itemId,
    matched_words: a.matched, category: a.category, result: "blocked", tier: a.tier,
  };
}

export function reviewQueueItem(a: { userId: string; itemType: string; itemId: string }): Record<string, unknown> {
  return { user_id: a.userId, item_type: a.itemType, item_id: a.itemId, status: "pending" };
}
