import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { MediaAnalysisEntry } from "@/hooks/useMediaAnalysis";
import { MediaAnalysisOverlay } from "../MediaAnalysisOverlay";

// Regression from the notes review of 2026-09-29: attachments render through
// signed URLs (.../object/sign/note-attachments/<path>?token=...). The storage
// path was read from the whole URL, token included, so no image ever matched
// its analysis row and the inline badges and Retry never appeared.

const media = vi.hoisted(() => ({
  entries: [] as MediaAnalysisEntry[],
  mutate: vi.fn(),
}));

vi.mock("@/hooks/useMediaAnalysis", () => ({
  useMediaAnalysis: () => ({ data: media.entries }),
  useReanalyzeMedia: () => ({ mutate: media.mutate, isPending: false, isPathPending: () => false }),
}));

const entry = (over: Partial<MediaAnalysisEntry>): MediaAnalysisEntry => ({
  id: "m1",
  note_id: "n1",
  storage_path: "u1/3f2a photo.png",
  media_type: "image",
  page_number: null,
  original_filename: "photo.png",
  extracted_text: null,
  description: null,
  topics: null,
  raw_analysis: null,
  analysis_status: "failed",
  error_message: null,
  created_at: null,
  updated_at: null,
  ...over,
});

let restoreOffsetParent: (() => void) | null = null;

beforeEach(() => {
  media.mutate.mockReset();
  // jsdom does no layout, so offsetParent is always null and the badge never
  // positions itself. Any parent will do for these tests.
  const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetParent");
  Object.defineProperty(HTMLElement.prototype, "offsetParent", {
    configurable: true,
    get() {
      return (this as HTMLElement).parentElement;
    },
  });
  restoreOffsetParent = () => {
    if (original) Object.defineProperty(HTMLElement.prototype, "offsetParent", original);
  };
});
afterEach(() => {
  cleanup();
  restoreOffsetParent?.();
  document.body.innerHTML = "";
});

function mountWithImage(src: string) {
  const editor = document.createElement("div");
  const img = document.createElement("img");
  img.src = src;
  editor.appendChild(img);
  document.body.appendChild(editor);
  render(
    <MemoryRouter>
      <MediaAnalysisOverlay noteId="n1" editorContainerRef={{ current: editor }} />
    </MemoryRouter>,
  );
}

describe("MediaAnalysisOverlay", () => {
  it("finds the analysis for an image shown through a signed URL", async () => {
    media.entries = [entry({ analysis_status: "failed" })];
    mountWithImage(
      "https://proj.supabase.co/storage/v1/object/sign/note-attachments/u1/3f2a%20photo.png?token=eyJhbGciOi.abc.def",
    );

    const retry = await screen.findByRole("button", { name: /retry/i });
    await act(async () => fireEvent.click(retry));
    expect(media.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ noteId: "n1", storagePath: "u1/3f2a photo.png", mediaType: "image" }),
    );
  });

  it("still finds the analysis for an older public URL", async () => {
    media.entries = [entry({ analysis_status: "complete" })];
    mountWithImage("https://proj.supabase.co/storage/v1/object/public/note-attachments/u1/3f2a%20photo.png");

    expect(await screen.findByRole("button", { name: /ai/i })).toBeInTheDocument();
  });

  it("shows nothing for an image that is not an attachment", async () => {
    media.entries = [entry({ analysis_status: "failed" })];
    mountWithImage("https://example.com/pictures/photo.png?token=u1/3f2a%20photo.png");

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(screen.queryByRole("button", { name: /retry/i })).not.toBeInTheDocument();
  });
});
