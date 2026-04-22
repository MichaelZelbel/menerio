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
      // If we trimmed, reset the summarizedUpTo offset accordingly.
      summarizedUpTo: Math.min(
        state.summarizedUpTo,
        Math.max(0, state.messages.length - MAX_STORED_MESSAGES) +
          state.summarizedUpTo,
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
 * Build the API payload: a sliding window of the most recent messages,
 * with an optional summary message prepended so older context is not lost.
 */
export function buildApiMessages(state: PersistedChatState): Array<{
  role: "user" | "assistant" | "system";
  content: string;
}> {
  const recent = state.messages.slice(-CHAT_WINDOW_SIZE).map((m) => ({
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

/** Note-modifying tools we should react to in the UI. */
export const NOTE_MODIFYING_TOOLS = [
  "append_to_note",
  "update_note_metadata",
  "update_note_tags",
  "add_wikilink",
];
