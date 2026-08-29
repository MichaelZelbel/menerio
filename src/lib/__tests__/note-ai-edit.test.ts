import { describe, it, expect, afterEach } from "vitest";
import {
  applyNoteEditVerified,
  NOTE_UPDATED_EVENT,
  NOTE_UPDATE_ACK_EVENT,
} from "@/lib/note-ai-edit";

type Detail = {
  noteId: string;
  content?: string;
  updatedAt?: string;
  ackId?: string;
  force?: boolean;
};

const listeners: EventListener[] = [];

/** Stand-in for the open NoteEditor: answers apply requests like it does. */
function mountFakeEditor(
  respond: (detail: Detail) => { applied: boolean; error?: string } | null,
) {
  const handler = ((e: Event) => {
    const detail = (e as CustomEvent<Detail>).detail;
    const answer = respond(detail);
    if (!answer || !detail.ackId) return;
    window.dispatchEvent(
      new CustomEvent(NOTE_UPDATE_ACK_EVENT, {
        detail: { ackId: detail.ackId, ...answer },
      }),
    );
  }) as EventListener;
  window.addEventListener(NOTE_UPDATED_EVENT, handler);
  listeners.push(handler);
}

afterEach(() => {
  while (listeners.length) {
    window.removeEventListener(NOTE_UPDATED_EVENT, listeners.pop()!);
  }
});

describe("applyNoteEditVerified", () => {
  it("reports applied when the editor acknowledges the first pass", async () => {
    const seen: Detail[] = [];
    mountFakeEditor((d) => {
      seen.push(d);
      return { applied: true };
    });
    const result = await applyNoteEditVerified("n1", "hello", "2026-01-01T00:00:00Z");
    expect(result.status).toBe("applied");
    expect(seen).toHaveLength(1);
    expect(seen[0].content).toBe("hello");
    expect(seen[0].force).toBe(false);
  });

  it("retries with a forced refetch when the first pass did not converge", async () => {
    const seen: Detail[] = [];
    mountFakeEditor((d) => {
      seen.push(d);
      return { applied: seen.length > 1 };
    });
    const result = await applyNoteEditVerified("n1", "hello", null);
    expect(result.status).toBe("applied");
    expect(seen).toHaveLength(2);
    // Second pass drops the content hint so the editor re-reads the row, and
    // forces the result in regardless of what it currently shows.
    expect(seen[1].content).toBeUndefined();
    expect(seen[1].force).toBe(true);
  });

  it("fails loudly when even the forced pass does not converge", async () => {
    mountFakeEditor(() => ({ applied: false, error: "editor content did not converge" }));
    const result = await applyNoteEditVerified("n1", "hello", null);
    expect(result.status).toBe("failed");
    expect(result.error).toBe("editor content did not converge");
  });

  it("reports no-editor (not a failure) when the note is not open", async () => {
    const result = await applyNoteEditVerified("n1", "hello", null);
    expect(result.status).toBe("no-editor");
  }, 10000);
});
