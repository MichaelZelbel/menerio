import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { copyToClipboard, COPY_FAILED_MESSAGE } from "@/lib/clipboard";
import { SingleFileIntegration } from "../SingleFileIntegration";

const toastError = vi.fn();
vi.mock("@/lib/toast", () => ({
  showToast: { error: (...a: unknown[]) => toastError(...a), success: vi.fn(), copied: vi.fn() },
}));

const writeText = vi.fn();
const realClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");

beforeEach(() => {
  writeText.mockReset();
  toastError.mockReset();
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
});

afterEach(() => {
  if (realClipboard) Object.defineProperty(navigator, "clipboard", realClipboard);
  else delete (navigator as { clipboard?: unknown }).clipboard;
});

describe("copyToClipboard", () => {
  it("reports success only once the browser accepted the text", async () => {
    writeText.mockResolvedValue(undefined);
    await expect(copyToClipboard("abc")).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("abc");
  });

  it("reports failure when the browser refuses, instead of throwing", async () => {
    writeText.mockRejectedValue(new DOMException("Document is not focused.", "NotAllowedError"));
    await expect(copyToClipboard("abc")).resolves.toBe(false);
  });

  it("reports failure when there is no clipboard at all", async () => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
    await expect(copyToClipboard("abc")).resolves.toBe(false);
  });
});

describe("a copy button", () => {
  it("tells the person to copy by hand when the copy was refused", async () => {
    writeText.mockRejectedValue(new DOMException("denied", "NotAllowedError"));
    render(
      <MemoryRouter>
        <SingleFileIntegration />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Copy URL" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(COPY_FAILED_MESSAGE));
  });
});
