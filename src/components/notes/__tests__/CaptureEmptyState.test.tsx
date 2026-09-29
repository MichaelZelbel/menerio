import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { CaptureEmptyState } from "../CaptureEmptyState";

// Regression from the notes review of 2026-09-29: every tile was a clickable
// div, so none of them could be reached or pressed from the keyboard.

afterEach(cleanup);

describe("CaptureEmptyState", () => {
  it("makes Quick Capture a button and each integration a link", () => {
    const onCreateNote = vi.fn();
    render(
      <MemoryRouter>
        <CaptureEmptyState onCreateNote={onCreateNote} variant="compact" />
      </MemoryRouter>,
    );

    const quick = screen.getByRole("button", { name: /quick capture/i });
    fireEvent.click(quick);
    expect(onCreateNote).toHaveBeenCalledTimes(1);

    expect(screen.getByRole("link", { name: /telegram/i })).toHaveAttribute("href", "/dashboard/settings?tab=telegram");
    expect(screen.getByRole("link", { name: /web clipper/i })).toHaveAttribute("href", "/dashboard/settings?tab=singlefile");
    expect(screen.getByRole("link", { name: /mcp server/i })).toHaveAttribute("href", "/dashboard/settings?tab=mcp");
  });

  it("leaves out Quick Capture when there is nothing to create with", () => {
    render(
      <MemoryRouter>
        <CaptureEmptyState variant="compact" />
      </MemoryRouter>,
    );
    expect(screen.queryByRole("button", { name: /quick capture/i })).not.toBeInTheDocument();
  });
});
