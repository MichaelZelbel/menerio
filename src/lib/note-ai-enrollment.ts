import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";

/** One authenticated transaction saves a capture and its durable subscription. */
export async function captureNoteWithLexicon(note: Record<string, unknown>, authorization?: string): Promise<unknown> {
  // The migration ships before the frontend; generated RPC types follow release.
  const request = supabase.rpc("capture_note_with_lexicon" as never, {
    _note: note as Json,
  } as never);
  // Offline uploads must retain the identity checked before constructing the
  // request, even if global auth switches before the request starts.
  const { data, error } = await (authorization ? request.setHeader("Authorization", authorization) : request);
  if (error) throw error;
  return data;
}

/** Authorized, idempotent enrollment only. The server owns paid scheduling. */
export async function enrollNoteInLexicon(noteId: string): Promise<void> {
  const { error } = await supabase.functions.invoke("wiki-ingest", {
    body: { note_id: noteId, change_type: "INSERT" },
  });
  if (error) throw error;
}

const PREFIX = "menerio:lexicon-enrollment:";

/** Compatibility retry for pre-migration ID-only intents; never used for new saves. */
async function enrollSavedNote(note: { id: string; user_id: string }): Promise<void> {
  const key = `${PREFIX}${note.user_id}:${note.id}`;
  try {
    localStorage.setItem(key, note.id);
  } catch (error) {
    // Storage denial must not turn a confirmed note save into a failed save.
    console.warn("Could not retain Lexicon enrollment retry", error);
  }
  try {
    await enrollNoteInLexicon(note.id);
    localStorage.removeItem(key);
  } catch (error) {
    console.warn("Lexicon enrollment pending; note remains saved", error);
  }
}

/** Retry only this account's confirmed captures, never a historical archive. */
export async function retryLexiconEnrollments(userId: string): Promise<void> {
  const prefix = `${PREFIX}${userId}:`;
  const notes: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(prefix)) notes.push(key.slice(prefix.length));
    }
  } catch (error) {
    console.warn("Could not read Lexicon enrollment retries", error);
  }
  for (const id of notes) await enrollSavedNote({ id, user_id: userId });
}
