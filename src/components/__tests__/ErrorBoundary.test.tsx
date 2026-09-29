import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ErrorBoundary } from "../ErrorBoundary";

function Boom({ message }: { message: string }): JSX.Element {
  throw new Error(message);
}

const STALE_A = "Failed to fetch dynamically imported module: https://app.example/assets/Notes-aaa.js";
const STALE_B = "Failed to fetch dynamically imported module: https://app.example/assets/Notes-bbb.js";

let reload: ReturnType<typeof vi.fn>;
beforeEach(() => {
  sessionStorage.clear();
  reload = vi.fn();
  vi.stubGlobal("location", { ...window.location, reload });
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ErrorBoundary", () => {
  it("clears a shown error when the route changes", () => {
    const { rerender } = render(
      <ErrorBoundary resetKey="/dashboard/graph">
        <Boom message="widget crashed" />
      </ErrorBoundary>,
    );
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    rerender(
      <ErrorBoundary resetKey="/dashboard/notes">
        <p>Notes page</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText("Notes page")).toBeInTheDocument();
  });

  it("reloads once per stale chunk, so a later deploy in the same tab reloads again without looping", () => {
    render(<ErrorBoundary><Boom message={STALE_A} /></ErrorBoundary>);
    expect(reload).toHaveBeenCalledTimes(1);
    cleanup();

    // The reload landed on the same missing chunk: no second reload.
    render(<ErrorBoundary><Boom message={STALE_A} /></ErrorBoundary>);
    expect(reload).toHaveBeenCalledTimes(1);
    cleanup();

    // A later deploy removes another chunk: this one reloads.
    render(<ErrorBoundary><Boom message={STALE_B} /></ErrorBoundary>);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it("does not reload for an ordinary error", () => {
    render(<ErrorBoundary><Boom message="Cannot read properties of undefined" /></ErrorBoundary>);
    expect(reload).not.toHaveBeenCalled();
  });
});
