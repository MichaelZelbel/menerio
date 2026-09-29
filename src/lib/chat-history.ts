/**
 * Persistent chat history helpers.
 *
 * History is stored per (user, context) in localStorage. The "context" is
 * either a specific note (note:<noteId>) or the general knowledge base.
 *
 * We also persist a rolling summary so that older turns survive across
 * the sliding window we send to the LLM.
 */

export interface PersistedChatMessage {
  role: "user" | "assistant";
  content: string;
  toolResults?: Array<{
    tool: string;
    args: Record<string, unknown>;
    result: Record<string, unknown>;
  }>;
  /** Set when this turn edited the open note — enables one-click undo. */
  noteEdit?: {
    noteId: string;
    previousContent: string | null;
  };
  /** Notes this turn created, so the links survive a reload. */
  notesCreated?: Array<{
    id: string;
    title: string;
    folder_path: string;
  }>;
}


export interface PersistedChatState {
  messages: PersistedChatMessage[];
  summary: string; // rolling summary of older turns
  summarizedUpTo: number; // index in messages already folded into summary
}

const STORAGE_PREFIX = "menerio:chat:v1";
const MAX_STORED_MESSAGES = 200;

/** Default sliding-window size sent to the model (most recent N messages). */
export const CHAT_WINDOW_SIZE = 12;
/** When stored history exceeds this, fold older turns into the summary. */
export const SUMMARY_THRESHOLD = 16;
/**
 * How many messages must have left the window, unsummarized, before the next
 * (paid) summary call. The summary used to be redone from the whole older
 * transcript on EVERY turn once a chat passed SUMMARY_THRESHOLD: after one
 * summary, summarizedUpTo = len - 12, and the next turn adds two messages, so
 * the check always found something new. Until the next summary the messages
 * in between are sent as they are (see buildApiMessages), so nothing is lost.
 */
export const SUMMARY_STEP = SUMMARY_THRESHOLD - CHAT_WINDOW_SIZE + 4;
/** Upper bound on messages sent per turn, whatever the summary state. */
const MAX_SENT_MESSAGES = CHAT_WINDOW_SIZE + 2 * SUMMARY_STEP;

export function chatStorageKey(userId: string | undefined, contextKey: string): string {
  return `${STORAGE_PREFIX}:${userId || "anon"}:${contextKey}`;
}

export function loadChatState(
  userId: string | undefined,
  contextKey: string,
): PersistedChatState {
  if (typeof window === "undefined") {
    return { messages: [], summary: "", summarizedUpTo: 0 };
  }
  try {
    const raw = window.localStorage.getItem(chatStorageKey(userId, contextKey));
    if (!raw) return { messages: [], summary: "", summarizedUpTo: 0 };
    const parsed = JSON.parse(raw);
    return {
      messages: Array.isArray(parsed.messages) ? parsed.messages : [],
      summary: typeof parsed.summary === "string" ? parsed.summary : "",
      summarizedUpTo:
        typeof parsed.summarizedUpTo === "number" ? parsed.summarizedUpTo : 0,
    };
  } catch {
    return { messages: [], summary: "", summarizedUpTo: 0 };
  }
}

export function saveChatState(
  userId: string | undefined,
  contextKey: string,
  state: PersistedChatState,
): void {
  if (typeof window === "undefined") return;
  try {
    // Cap total stored messages so localStorage stays healthy.
    const trimmed: PersistedChatState = {
      ...state,
      messages: state.messages.slice(-MAX_STORED_MESSAGES),
      // summarizedUpTo is an index from the start of the messages array. When
      // we drop the oldest `dropped` messages, that index must shift down by
      // the same amount, or already-summarized offsets would point at newer,
      // never-summarized turns (which the summarizer would then skip and lose).
      summarizedUpTo: Math.max(
        0,
        state.summarizedUpTo -
          Math.max(0, state.messages.length - MAX_STORED_MESSAGES),
      ),
    };
    window.localStorage.setItem(
      chatStorageKey(userId, contextKey),
      JSON.stringify(trimmed),
    );
  } catch {
    // localStorage might be full — silently ignore.
  }
}

export function clearChatState(
  userId: string | undefined,
  contextKey: string,
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(chatStorageKey(userId, contextKey));
  } catch {
    // ignore
  }
}

/**
 * Build the API payload: every message the summary does not cover yet (at
 * least the last CHAT_WINDOW_SIZE), with the summary prepended so older
 * context is not lost. Without a summary the whole short history goes: a chat
 * of 13 to 16 messages used to drop its first turns with nothing covering them.
 */
export function buildApiMessages(state: PersistedChatState): Array<{
  role: "user" | "assistant" | "system";
  content: string;
}> {
  const len = state.messages.length;
  const hasSummary = !!state.summary && state.summary.trim().length > 0;
  const covered = hasSummary ? Math.min(state.summarizedUpTo, Math.max(0, len - CHAT_WINDOW_SIZE)) : 0;
  const start = Math.max(covered, len - MAX_SENT_MESSAGES, 0);
  const recent = state.messages.slice(start).map((m) => ({
    role: m.role,
    content: m.content,
  }));
  if (state.summary && state.summary.trim().length > 0) {
    return [
      {
        role: "system" as const,
        content: `Conversation summary so far:\n${state.summary}`,
      },
      ...recent,
    ];
  }
  return recent;
}

/**
 * The next batch to fold into the rolling summary, or null while fewer than
 * SUMMARY_STEP messages have left the window since the last summary. Only the
 * new messages are sent, after the previous summary, so the summary call no
 * longer grows with the whole conversation.
 */
export function nextSummaryBatch(state: PersistedChatState): {
  transcript: Array<{ role: "user" | "assistant"; content: string }>;
  upTo: number;
} | null {
  const upTo = state.messages.length - CHAT_WINDOW_SIZE;
  if (state.messages.length < SUMMARY_THRESHOLD) return null;
  const from = Math.max(0, Math.min(state.summarizedUpTo, upTo));
  if (upTo - from < SUMMARY_STEP) return null;
  const fresh = state.messages.slice(from, upTo).map((m) => ({ role: m.role, content: m.content }));
  const previous = state.summary.trim()
    ? [{ role: "assistant" as const, content: `Summary of the conversation before this point: ${state.summary.trim()}` }]
    : [];
  return { transcript: [...previous, ...fresh], upTo };
}

/**
 * Fold a finished summary into a state. It only moves forward: a summary that
 * finishes after a newer one, or after the chat was cleared, changes nothing.
 * `messageCountAtRequest` is the length the batch was taken from, so a state
 * whose history was trimmed or cleared in between is left alone.
 */
export function withSummary(
  state: PersistedChatState,
  summary: string,
  upTo: number,
  messageCountAtRequest: number,
): PersistedChatState {
  if (!summary.trim()) return state;
  if (state.messages.length < messageCountAtRequest) return state;
  if (upTo <= state.summarizedUpTo) return state;
  return { ...state, summary: summary.trim(), summarizedUpTo: upTo };
}

/** Note-modifying tools we should react to in the UI. */
export const NOTE_MODIFYING_TOOLS = [
  "append_to_note",
  "insert_into_note",
  "replace_in_note",
  "update_note_metadata",
  "update_note_tags",
  "add_wikilink",
];


/** Note-creating tools. These add a note, they never change an existing one. */
export const NOTE_CREATING_TOOLS = ["create_note"];

/** Collection-modifying tools (create/update/delete items) — used by CollectionChatPanel. */
export const COLLECTION_MODIFYING_TOOLS = [
  "create_collection_item",
  "update_collection_item",
  "delete_collection_item",
];
