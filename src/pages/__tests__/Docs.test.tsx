import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Docs from "../Docs";
import { BRAND } from "@/lib/brand";

// jsdom has neither; the page uses them for the table of contents and to
// scroll to the top on a page change.
beforeAll(() => {
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
});

afterAll(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const renderAt = (url: string) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <Docs />
    </MemoryRouter>,
  );

describe("Docs", () => {
  it("starts a search from ?q=, the way the 404 page sends it", () => {
    renderAt("/docs?q=zzzz-nothing-matches");
    expect(screen.getByRole("textbox", { name: "Search documentation" })).toHaveValue("zzzz-nothing-matches");
    expect(screen.getByText(/No documentation page matches/)).toBeInTheDocument();
  });

  it("does not thank the reader for feedback it never stores", () => {
    renderAt("/docs");
    expect(screen.queryByText(/Was this page helpful/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Thanks for the feedback/)).not.toBeInTheDocument();
    const href = screen.getByRole("link", { name: BRAND.supportEmail }).getAttribute("href") ?? "";
    expect(href.startsWith(`mailto:${BRAND.supportEmail}?subject=`)).toBe(true);
  });

  it("gives the open phone menu its own close button", () => {
    renderAt("/docs");
    fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    const closers = screen.getAllByRole("button", { name: "Close navigation" });
    // The toggle, which the full-screen menu covers, and one inside the menu.
    expect(closers).toHaveLength(2);
    fireEvent.click(closers[1]);
    expect(screen.queryAllByRole("button", { name: "Close navigation" })).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Open navigation" })).toBeInTheDocument();
  });
});
