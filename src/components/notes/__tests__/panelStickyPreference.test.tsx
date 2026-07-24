import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { BacklinksPanel } from "../BacklinksPanel";
import { OutgoingLinksPanel } from "../OutgoingLinksPanel";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({ eq: () => ({ eq: () => Promise.resolve({ data: [] }) }) }),
        in: () => ({ eq: () => Promise.resolve({ data: [] }) }),
      }),
    }),
  },
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "u1" } }),
}));

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  );
}

describe("sticky panel preference", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("BacklinksPanel starts collapsed and remembers expand across notes", () => {
    const { rerender, unmount } = render(
      wrap(<BacklinksPanel noteId="a" onNavigate={() => {}} />),
    );
    // Collapsed by default: chevron is right-facing (not expanded region).
    // Expand by clicking the header button.
    fireEvent.click(screen.getByRole("button", { name: /backlinks/i }));
    // Switch to another note — preference should persist as expanded.
    rerender(wrap(<BacklinksPanel noteId="b" onNavigate={() => {}} />));
    expect(window.localStorage.getItem("menerio.panelPrefs.note-backlinks")).toBe(
      "true",
    );
    unmount();

    // Fresh mount on yet another note: still expanded because it's sticky.
    render(wrap(<BacklinksPanel noteId="c" onNavigate={() => {}} />));
    expect(window.localStorage.getItem("menerio.panelPrefs.note-backlinks")).toBe(
      "true",
    );
  });

  it("OutgoingLinksPanel default is collapsed when no preference stored", () => {
    render(wrap(<OutgoingLinksPanel noteId="a" onNavigate={() => {}} />));
    // No preference written yet.
    expect(
      window.localStorage.getItem("menerio.panelPrefs.note-links"),
    ).toBeNull();
  });

  it("OutgoingLinksPanel remembers collapsed choice after user closes it", () => {
    window.localStorage.setItem(
      "menerio.panelPrefs.note-links",
      JSON.stringify(true),
    );
    render(wrap(<OutgoingLinksPanel noteId="a" onNavigate={() => {}} />));
    fireEvent.click(screen.getByRole("button", { name: /links/i }));
    expect(window.localStorage.getItem("menerio.panelPrefs.note-links")).toBe(
      "false",
    );
  });
});
