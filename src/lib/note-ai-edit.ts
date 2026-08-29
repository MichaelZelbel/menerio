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
/** The editor answers every NOTE_UPDATED_EVENT that carries an `ackId`. */
export const NOTE_UPDATE_ACK_EVENT = "menerio:note-updated-ack";


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

export type NoteEditApplyStatus = "applied" | "no-editor" | "failed";

export interface NoteEditApplyResult {
  status: NoteEditApplyStatus;
  error?: string;
}

interface AckDetail {
  ackId?: string;
  applied?: boolean;
  error?: string;
}

/**
 * Dispatch one apply attempt and wait for the editor's acknowledgement.
 * Resolves `null` when no editor answered (note not open) — that is not a
 * failure, there is simply nothing on screen to converge.
 */
function dispatchApply(
  noteId: string,
  content: string | null | undefined,
  updatedAt: string | null | undefined,
  force: boolean,
  timeoutMs: number,
): Promise<{ applied: boolean; error?: string } | null> {
  const ackId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return new Promise((resolve) => {
    let settled = false;
    const done = (value: { applied: boolean; error?: string } | null) => {
      if (settled) return;
      settled = true;
      window.removeEventListener(NOTE_UPDATE_ACK_EVENT, handler as EventListener);
      clearTimeout(timer);
      resolve(value);
    };
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<AckDetail>).detail;
      if (detail?.ackId !== ackId) return;
      done({ applied: !!detail.applied, error: detail.error });
    };
    const timer = setTimeout(() => done(null), timeoutMs);
    window.addEventListener(NOTE_UPDATE_ACK_EVENT, handler as EventListener);
    window.dispatchEvent(
      new CustomEvent(NOTE_UPDATED_EVENT, {
        detail: {
          noteId,
          content: content ?? undefined,
          updatedAt: updatedAt ?? undefined,
          ackId,
          force,
        },
      }),
    );
  });
}

/**
 * Apply an AI edit to the open editor and *verify* that it landed.
 *
 * A single fire-and-forget event was not enough: when the editor dropped the
 * update (stale prop race, silent throw) the chat still reported success while
 * the note looked unchanged — and the next keystroke could save the stale text
 * back over the AI's work. So we ask, check the answer, and on a mismatch make
 * the editor re-read the row from the database and force the content in.
 */
export async function applyNoteEditVerified(
  noteId: string,
  content: string | null,
  updatedAt: string | null,
): Promise<NoteEditApplyResult> {
  if (typeof window === "undefined" || !noteId) return { status: "no-editor" };

  const first = await dispatchApply(noteId, content, updatedAt, false, 2500);
  if (!first) return { status: "no-editor" };
  if (first.applied) return { status: "applied" };

  // Second pass: no content hint, so the editor refetches the authoritative
  // row, and `force` bypasses every "looks unchanged / busy" shortcut.
  await new Promise((r) => setTimeout(r, 500));
  const second = await dispatchApply(noteId, undefined, undefined, true, 5000);
  if (!second) return { status: "no-editor" };
  if (second.applied) return { status: "applied" };
  return { status: "failed", error: second.error ?? first.error };
}

