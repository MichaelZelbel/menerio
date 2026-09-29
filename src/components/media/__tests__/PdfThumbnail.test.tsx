import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";

const destroy = vi.fn(() => Promise.resolve());
const getDocument = vi.fn();

vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: {},
  getDocument: (...args: unknown[]) => getDocument(...args),
}));
vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?url", () => ({ default: "pdf.worker.js" }));

import { PdfThumbnail } from "@/components/media/PdfThumbnail";

function fakePage() {
  return {
    getViewport: ({ scale }: { scale: number }) => ({ width: 100 * scale, height: 140 * scale }),
    render: () => ({ promise: Promise.resolve(), cancel: vi.fn() }),
  };
}

beforeEach(() => {
  destroy.mockClear();
  getDocument.mockReset();
});

describe("PdfThumbnail", () => {
  it("ends the PDF worker once the thumbnail is drawn, and not twice on unmount", async () => {
    // jsdom has no 2D canvas; any object lets the render path run to the end.
    const getContext = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue({} as unknown as CanvasRenderingContext2D);
    getDocument.mockReturnValue({ promise: Promise.resolve({ getPage: async () => fakePage() }), destroy });
    const { container, unmount } = render(<PdfThumbnail url="https://example.test/a.pdf" />);
    await waitFor(() => expect(destroy).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(container.querySelector("canvas")?.style.display).toBe("block"));
    unmount();
    expect(destroy).toHaveBeenCalledTimes(1);
    getContext.mockRestore();
  });

  it("ends the PDF worker when the thumbnail unmounts before the document loads", async () => {
    let resolveDoc: (value: unknown) => void = () => {};
    getDocument.mockReturnValue({ promise: new Promise((resolve) => { resolveDoc = resolve; }), destroy });
    const { unmount } = render(<PdfThumbnail url="https://example.test/b.pdf" />);
    unmount();
    expect(destroy).toHaveBeenCalledTimes(1);
    resolveDoc({ getPage: async () => fakePage() });
    await Promise.resolve();
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("ends the PDF worker when loading fails", async () => {
    getDocument.mockReturnValue({ promise: Promise.reject(new Error("bad pdf")), destroy });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    render(<PdfThumbnail url="https://example.test/c.pdf" />);
    await waitFor(() => expect(destroy).toHaveBeenCalledTimes(1));
    warn.mockRestore();
  });
});
