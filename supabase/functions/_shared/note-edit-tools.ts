/**
 * Safe note-editing tools for the in-note AI agent.
 *
 * Design rules (all enforced here, not left to the model):
 *  - Never write a whole-document rewrite. Every tool is an append, an
 *    anchored insert, or an exact-match replace.
 *  - Optimistic concurrency: the client sends the `updated_at` the editor last
 *    persisted. If the row moved underneath us, we refuse and tell the model to
 *    re-read the note instead of clobbering the user's text.
 *  - Idempotency: an identical write inside one turn happens once. An append of
 *    text that is already present is a no-op.
 *  - Deletion guard: a write that removes existing user text is refused unless
 *    it is an explicit replace with `confirm_delete: true`.
 */

export interface NoteEditSession {
  noteId: string;
  /** `updated_at` (ms) the client editor last persisted; 0 = unknown. */
  baseUpdatedAt: number;
  /** Hash of the content the client editor was showing at turn start. */
  baseContentHash: string | null;
  /** Content before the first successful write of this turn. */
  originalContent: string | null;
  /** Content after the last successful write of this turn. */
  finalContent: string | null;
  finalUpdatedAt: string | null;
  /** Dedupe map: tool+args -> serialized result. */
  seen: Map<string, string>;
  didWrite: boolean;
}

/**
 * Stable, dependency-free content hash (FNV-1a, hex). The client uses the same
 * algorithm so we can tell "the text actually changed" apart from "some
 * background job bumped updated_at".
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

export function createNoteEditSession(
  noteId: string,
  baseUpdatedAt?: string | number | null,
  baseContentHash?: string | null,
): NoteEditSession {
  const base =
    typeof baseUpdatedAt === "number"
      ? baseUpdatedAt
      : baseUpdatedAt
        ? new Date(baseUpdatedAt).getTime()
        : 0;
  return {
    noteId,
    baseUpdatedAt: Number.isFinite(base) ? base : 0,
    baseContentHash: baseContentHash || null,
    originalContent: null,
    finalContent: null,
    finalUpdatedAt: null,
    seen: new Map(),
    didWrite: false,
  };
}

export const NOTE_EDIT_TOOL_SCHEMAS = [
  {
    type: "function",
    function: {
      name: "append_to_note",
      description:
        "Append markdown text to the END of the current note. Existing content is never touched. If the same text is already in the note, nothing is written.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "Markdown text to append" },
        },
        required: ["text"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "insert_into_note",
      description:
        "Insert markdown text at a precise location in the current note without removing anything. Either give `after_text` (an exact snippet that already exists in the note — the new text goes right after it) or `at` ('start' or 'end').",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "Markdown text to insert" },
          after_text: {
            type: "string",
            description:
              "Exact existing snippet to insert after. Must occur exactly once in the note.",
          },
          at: { type: "string", enum: ["start", "end"] },
        },
        required: ["text"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "replace_in_note",
      description:
        "Replace an exact snippet of the current note with new text. `find` must occur exactly once. Use ONLY when the user explicitly asked to change or remove that text. If the replacement removes a substantial amount of text, pass confirm_delete: true.",
      parameters: {
        type: "object",
        properties: {
          find: { type: "string", description: "Exact text currently in the note" },
          replace: { type: "string", description: "Replacement text (may be empty to delete)" },
          confirm_delete: {
            type: "boolean",
            description:
              "Set true only when the user explicitly asked to delete or shorten this text.",
          },
        },
        required: ["find", "replace"],
        additionalProperties: false,
      },
    },
  },
];

export const NOTE_EDIT_TOOL_NAMES = NOTE_EDIT_TOOL_SCHEMAS.map(
  (t) => t.function.name,
);

/** Max characters of existing text a write may remove without confirm_delete. */
const DELETE_ALLOWANCE = 40;

function norm(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

function excerpt(s: string, max = 400): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let n = 0;
  let i = haystack.indexOf(needle);
  while (i !== -1) {
    n++;
    i = haystack.indexOf(needle, i + needle.length);
  }
  return n;
}

/**
 * Verify no existing text vanished. Returns an error string when the write
 * would delete user content without explicit confirmation.
 */
function deletionGuard(
  before: string,
  after: string,
  confirmed: boolean,
): string | null {
  const removed = Math.max(0, before.length - after.length);
  if (after.includes(before)) return null; // pure insertion
  if (confirmed) return null;
  if (removed > DELETE_ALLOWANCE) {
    return `Refused: this edit would remove ${removed} characters of existing note text. I never delete the user's writing unless they explicitly asked for it. If they did, retry with confirm_delete: true.`;
  }
  return null;
}

async function loadNote(
  db: any,
  userId: string,
  noteId: string,
): Promise<{ content: string; updated_at: string } | null> {
  const { data } = await db
    .from("notes")
    .select("content, updated_at")
    .eq("id", noteId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) return null;
  return { content: data.content ?? "", updated_at: data.updated_at };
}

async function writeNote(
  db: any,
  userId: string,
  noteId: string,
  content: string,
): Promise<{ updated_at: string } | { error: string }> {
  const { data, error } = await db
    .from("notes")
    .update({ content })
    .eq("id", noteId)
    .eq("user_id", userId)
    .select("updated_at")
    .single();
  if (error) return { error: error.message };
  return { updated_at: data.updated_at };
}

/**
 * Execute one note-edit tool. Always returns a JSON string.
 */
export async function executeNoteEditTool(
  db: any,
  userId: string,
  session: NoteEditSession,
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  const noteId = session.noteId;
  if (!noteId) {
    return JSON.stringify({ error: "No note is open — cannot edit." });
  }

  // ---- Dedupe identical write calls inside one turn ----------------------
  const key = `${name}:${JSON.stringify(args)}`;
  const prior = session.seen.get(key);
  if (prior !== undefined) {
    const parsed = JSON.parse(prior);
    return JSON.stringify({
      ...parsed,
      duplicate_call: true,
      note: "This exact edit was already performed in this turn — it was NOT applied a second time. Do not retry it.",
    });
  }

  const current = await loadNote(db, userId, noteId);
  if (!current) return JSON.stringify({ error: "Note not found" });

  // ---- Optimistic concurrency ------------------------------------------
  // Only destructive-capable writes are guarded. Appends and unanchored
  // inserts can never remove text, so they always proceed on top of the
  // freshly loaded content. For the guarded tools we compare CONTENT, not the
  // row timestamp: background jobs (metadata extraction, smart titles,
  // embeddings, lexicon sync) bump `updated_at` without touching the text.
  const currentTs = new Date(current.updated_at).getTime();
  const isDestructiveCapable =
    name === "replace_in_note" ||
    (name === "insert_into_note" && typeof args.after_text === "string" && !!args.after_text);
  const contentMoved = session.baseContentHash
    ? hashNoteContent(current.content) !== session.baseContentHash
    : session.baseUpdatedAt > 0 && currentTs > session.baseUpdatedAt + 1000;
  if (!session.didWrite && isDestructiveCapable && contentMoved) {
    const result = {
      error: "stale",
      message:
        "The note changed after this conversation turn started. Nothing was written. The current content is below — re-check it and, only if the edit is still needed, call the tool again.",
      current_content: excerpt(current.content, 4000),
    };
    return JSON.stringify(result);
  }

  const before = current.content;
  let after: string;
  let confirmed = false;
  const meta: Record<string, unknown> = {};

  switch (name) {
    case "append_to_note": {
      const text = String(args.text ?? "");
      if (!text.trim()) return JSON.stringify({ error: "text is empty" });
      if (norm(before).includes(norm(text))) {
        const res = {
          success: true,
          action: "append_to_note",
          already_present: true,
          message:
            "That text is already in the note — nothing was appended. Do not try again.",
        };
        session.seen.set(key, JSON.stringify(res));
        return JSON.stringify(res);
      }
      after = before.trimEnd() + "\n\n" + text.trim() + "\n";
      break;
    }

    case "insert_into_note": {
      const text = String(args.text ?? "");
      if (!text.trim()) return JSON.stringify({ error: "text is empty" });
      const afterText = typeof args.after_text === "string" ? args.after_text : "";
      if (norm(before).includes(norm(text))) {
        const res = {
          success: true,
          action: "insert_into_note",
          already_present: true,
          message:
            "That text is already in the note — nothing was inserted. Do not try again.",
        };
        session.seen.set(key, JSON.stringify(res));
        return JSON.stringify(res);
      }
      if (afterText) {
        const hits = countOccurrences(before, afterText);
        if (hits === 0) {
          return JSON.stringify({
            error: "anchor_not_found",
            message:
              "`after_text` does not appear in the note verbatim. Copy an exact snippet from the note content, or use at: 'end'.",
          });
        }
        if (hits > 1) {
          return JSON.stringify({
            error: "anchor_ambiguous",
            message: `\`after_text\` occurs ${hits} times. Provide a longer, unique snippet.`,
          });
        }
        const idx = before.indexOf(afterText) + afterText.length;
        after = before.slice(0, idx) + "\n\n" + text.trim() + before.slice(idx);
      } else if (args.at === "start") {
        after = text.trim() + "\n\n" + before.trimStart();
      } else {
        after = before.trimEnd() + "\n\n" + text.trim() + "\n";
      }
      break;
    }

    case "replace_in_note": {
      const find = String(args.find ?? "");
      const replace = String(args.replace ?? "");
      confirmed = args.confirm_delete === true;
      if (!find) return JSON.stringify({ error: "find is empty" });
      const hits = countOccurrences(before, find);
      if (hits === 0) {
        return JSON.stringify({
          error: "not_found",
          message:
            "`find` does not appear in the note verbatim. Copy the exact text from the note content.",
        });
      }
      if (hits > 1) {
        return JSON.stringify({
          error: "ambiguous",
          message: `\`find\` occurs ${hits} times — nothing was changed. Provide a longer, unique snippet.`,
        });
      }
      after = before.replace(find, replace);
      meta.replaced = excerpt(find, 200);
      break;
    }

    default:
      return JSON.stringify({ error: `Unknown edit tool: ${name}` });
  }

  if (after === before) {
    const res = { success: true, action: name, unchanged: true };
    session.seen.set(key, JSON.stringify(res));
    return JSON.stringify(res);
  }

  const guardError = deletionGuard(before, after, confirmed);
  if (guardError) {
    return JSON.stringify({ error: "deletion_blocked", message: guardError });
  }

  const written = await writeNote(db, userId, noteId, after);
  if ("error" in written) return JSON.stringify({ error: written.error });

  if (session.originalContent === null) session.originalContent = before;
  session.finalContent = after;
  session.finalUpdatedAt = written.updated_at;
  session.didWrite = true;
  session.baseUpdatedAt = new Date(written.updated_at).getTime();

  const res = {
    success: true,
    action: name,
    ...meta,
    chars_added: Math.max(0, after.length - before.length),
    chars_removed: Math.max(0, before.length - after.length),
    after_excerpt: excerpt(after.slice(-600), 600),
    new_updated_at: written.updated_at,
  };
  session.seen.set(key, JSON.stringify(res));
  return JSON.stringify(res);
}
