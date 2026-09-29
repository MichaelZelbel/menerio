import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { Note } from "@/hooks/useNotes";
import { NoteList } from "../NoteList";

// Regression from the notes review of 2026-09-29: "Copy link" said "Copied"
// without waiting for the clipboard, so a refused write still reported success.

const toast = vi.hoisted(() => ({ copied: vi.fn(), error: vi.fn(), success: vi.fn() }));
vi.mock("@/lib/toast", () => ({ showToast: toast }));
vi.mock("../BulkActionBar", () => ({ BulkActionBar: () => null }));
// jsdom does no layout, so the virtualizer would render no rows.
vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getVirtualItems: () => Array.from({ length: count }, (_, index) => ({ index, key: index, start: index * 92 })),
    getTotalSize: () => count * 92,
    measureElement: () => {},
  }),
}));

const note = {
  id: "n1",
  user_id: "u1",
  title: "Copy me",
  content: "",
  metadata: null,
  tags: [],
  is_favorite: false,
  is_pinned: false,
  is_trashed: false,
  created_at: "2026-09-01T10:00:00Z",
  updated_at: "2026-09-01T10:00:00Z",
} as unknown as Note;

const originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");

function setClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
}

beforeEach(() => {
  toast.copied.mockReset();
  toast.error.mockReset();
});
afterEach(() => {
  cleanup();
  if (originalClipboard) Object.defineProperty(navigator, "clipboard", originalClipboard);
  else delete (navigator as { clipboard?: unknown }).clipboard;
});

function mount() {
  render(
    <MemoryRouter>
      <NoteList notes={[note]} selectedId={null} onSelect={vi.fn()} />
    </MemoryRouter>,
  );
  return screen.getByTitle("Copy link");
}

describe("NoteList copy link", () => {
  it("reports success only after the clipboard accepted the link", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard(writeText);
    fireEvent.click(mount());

    await waitFor(() => expect(toast.copied).toHaveBeenCalledTimes(1));
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/dashboard/notes/n1`);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("says so when the clipboard refuses", async () => {
    setClipboard(vi.fn().mockRejectedValue(new Error("NotAllowedError")));
    fireEvent.click(mount());

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Could not copy. Select the text and copy it by hand."),
    );
    expect(toast.copied).not.toHaveBeenCalled();
  });
});
