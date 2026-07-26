/**
 * Coordination between the AI chat panels and the open NoteEditor.
 *
 * Two problems this solves:
 *  1. The editor holds the user's newest text in an 800ms debounce. If the AI
 *     writes to the same row in that window, one of the two writes is lost.
 *     `flushNoteSave` asks the editor to persist immediately and waits for it.
 *  2. After the AI edits the note we know the exact resulting content, so we
 *     hand it straight to the editor instead of making it refetch (and instead
 *     of it ignoring the update because it happens to be focused).
 */

export const FLUSH_REQUEST_EVENT = "menerio:flush-note-save";
export const FLUSH_DONE_EVENT = "menerio:flush-note-save-done";
export const NOTE_UPDATED_EVENT = "menerio:note-updated";

export interface NoteEditPayload {
  note_id: string;
  content: string | null;
  previous_content: string | null;
  updated_at: string | null;
}

/**
 * Ask the open editor for `noteId` to flush any pending autosave.
 * Resolves with the note's newest `updated_at` (ISO) or null when no editor
 * answered within the timeout.
 */
export function flushNoteSave(noteId: string, timeoutMs = 4000): Promise<string | null> {
  if (typeof window === "undefined" || !noteId) return Promise.resolve(null);
  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  return new Promise((resolve) => {
    let settled = false;
    const done = (value: string | null) => {
      if (settled) return;
      settled = true;
      window.removeEventListener(FLUSH_DONE_EVENT, handler as EventListener);
      clearTimeout(timer);
      resolve(value);
    };
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ requestId?: string; updatedAt?: string | null }>).detail;
      if (detail?.requestId !== requestId) return;
      done(detail?.updatedAt ?? null);
    };
    const timer = setTimeout(() => done(null), timeoutMs);
    window.addEventListener(FLUSH_DONE_EVENT, handler as EventListener);
    window.dispatchEvent(
      new CustomEvent(FLUSH_REQUEST_EVENT, { detail: { noteId, requestId } }),
    );
  });
}

/** Push an AI-produced note version straight into the open editor. */
export function applyNoteEdit(
  noteId: string,
  content: string | null,
  updatedAt: string | null,
) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(NOTE_UPDATED_EVENT, {
      detail: { noteId, content: content ?? undefined, updatedAt: updatedAt ?? undefined },
    }),
  );
}
