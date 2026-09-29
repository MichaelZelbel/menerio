import { describe, expect, it } from "vitest";
import {
  buildApiMessages,
  CHAT_WINDOW_SIZE,
  nextSummaryBatch,
  SUMMARY_STEP,
  SUMMARY_THRESHOLD,
  withSummary,
  type PersistedChatState,
} from "../chat-history";

function chat(n: number, summary = "", summarizedUpTo = 0): PersistedChatState {
  return {
    messages: Array.from({ length: n }, (_, i) => ({ role: i % 2 === 0 ? ("user" as const) : ("assistant" as const), content: `m${i}` })),
    summary,
    summarizedUpTo,
  };
}

describe("chat summary", () => {
  it("does not summarize again on the very next turn (it used to on every turn, each one a paid call)", () => {
    const first = nextSummaryBatch(chat(SUMMARY_THRESHOLD + SUMMARY_STEP));
    expect(first).not.toBeNull();
    const after = withSummary(chat(SUMMARY_THRESHOLD + SUMMARY_STEP), "S1", first!.upTo, SUMMARY_THRESHOLD + SUMMARY_STEP);
    // One more exchange (two messages).
    const nextTurn = { ...after, messages: [...after.messages, ...chat(2).messages] };
    expect(nextSummaryBatch(nextTurn)).toBeNull();
  });

  it("sends only the new messages after the previous summary", () => {
    const state = chat(40, "earlier summary", 10);
    const batch = nextSummaryBatch(state)!;
    expect(batch.upTo).toBe(40 - CHAT_WINDOW_SIZE);
    expect(batch.transcript[0].content).toContain("earlier summary");
    expect(batch.transcript.slice(1).map((m) => m.content)).toEqual(state.messages.slice(10, 28).map((m) => m.content));
  });

  it("never loses messages between summaries: everything the summary does not cover is sent", () => {
    // Summary covers the first 10; the window alone would start at 13.
    const state = chat(25, "S", 10);
    const sent = buildApiMessages(state);
    expect(sent[0].role).toBe("system");
    expect(sent.slice(1).map((m) => m.content)).toEqual(state.messages.slice(10).map((m) => m.content));
  });

  it("sends a short chat whole instead of dropping its first turns", () => {
    const state = chat(14);
    expect(buildApiMessages(state)).toHaveLength(14);
  });

  it("bounds what is sent when summaries keep failing", () => {
    const state = chat(120);
    expect(buildApiMessages(state).length).toBeLessThanOrEqual(CHAT_WINDOW_SIZE + 2 * SUMMARY_STEP);
  });

  it("ignores a summary that finishes after the chat was cleared or a newer summary landed", () => {
    const cleared = chat(0);
    expect(withSummary(cleared, "late", 12, 24)).toBe(cleared);
    const newer = chat(30, "newer", 18);
    expect(withSummary(newer, "older", 12, 24)).toBe(newer);
  });
});
