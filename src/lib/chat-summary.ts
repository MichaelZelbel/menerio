import { supabase } from "@/integrations/supabase/client";
import { nextSummaryBatch, type PersistedChatState } from "@/lib/chat-history";

export interface ChatSummaryResult {
  summary: string;
  upTo: number;
  /** Message count of the state the batch was taken from (for withSummary). */
  messageCount: number;
}

/**
 * Fold the messages that left the window into the rolling summary, when
 * enough have (nextSummaryBatch). Best effort: null when nothing is due or the
 * call failed. Callers show the reply first and run this afterwards, so the
 * answer never waits for a second model call.
 */
export async function summarizeChat(
  chatFn: "note-chat" | "collection-chat",
  state: PersistedChatState,
): Promise<ChatSummaryResult | null> {
  const batch = nextSummaryBatch(state);
  if (!batch) return null;
  try {
    const { data, error } = await supabase.functions.invoke(chatFn, {
      body: { mode: "summarize", messages: batch.transcript },
    });
    const summary = typeof data?.summary === "string" ? data.summary.trim() : "";
    if (error || !summary) return null;
    return { summary, upTo: batch.upTo, messageCount: state.messages.length };
  } catch {
    return null;
  }
}
