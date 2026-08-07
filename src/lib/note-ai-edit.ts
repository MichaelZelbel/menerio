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

/**
 * Stable content hash (FNV-1a, hex). Must stay byte-identical to
 * `hashNoteContent` in `supabase/functions/_shared/note-edit-tools.ts` — the
 * AI edit guard compares the two to detect real content changes (as opposed to
 * background jobs bumping `updated_at`).
 */
export function hashNoteContent(content: string | null | undefined): string {
  const s = content ?? "";
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${h.toString(16)}:${s.length}`;
}

export const FLUSH_REQUEST_EVENT = "menerio:flush-note-save";
export const FLUSH_DONE_EVENT = "menerio:flush-note-save-done";
export const NOTE_UPDATED_EVENT = "menerio:note-updated";

export interface NoteEditPayload {
  note_id: string;
  content: string | null;
  previous_content: string | null;
  updated_at: string | null;
}

export interface FlushResult {
  /** Newest persisted `updated_at` (ISO), or null when no editor answered. */
  updatedAt: string | null;
  /** The exact content that is now persisted, when the editor reported it. */
  content: string | null;
}

/**
 * Ask the open editor for `noteId` to flush any pending autosave.
 * Resolves with the note's newest `updated_at` and persisted content (both
 * null when no editor answered within the timeout).
 */
export function flushNoteSave(
  noteId: string,
  timeoutMs = 4000,
): Promise<FlushResult> {
  if (typeof window === "undefined" || !noteId)
    return Promise.resolve({ updatedAt: null, content: null });
  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  return new Promise<FlushResult>((resolve) => {
    let settled = false;
    const done = (value: FlushResult) => {
      if (settled) return;
      settled = true;
      window.removeEventListener(FLUSH_DONE_EVENT, handler as EventListener);
      clearTimeout(timer);
      resolve(value);
    };
    const handler = (e: Event) => {
      const detail = (
        e as CustomEvent<{ requestId?: string; updatedAt?: string | null; content?: string | null }>
      ).detail;
      if (detail?.requestId !== requestId) return;
      done({ updatedAt: detail?.updatedAt ?? null, content: detail?.content ?? null });
    };
    const timer = setTimeout(() => done({ updatedAt: null, content: null }), timeoutMs);
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
