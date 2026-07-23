import { describe, it, expect, vi } from "vitest";
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

describe("panel collapse resets on note switch", () => {
  it("BacklinksPanel collapses when noteId changes", () => {
    const { rerender } = render(wrap(<BacklinksPanel noteId="a" onNavigate={() => {}} />));
    fireEvent.click(screen.getByRole("button", { name: /backlinks/i }));
    expect(screen.queryByText(/no notes link/i) || screen.queryByText(/loading/i)).toBeTruthy();
    rerender(wrap(<BacklinksPanel noteId="b" onNavigate={() => {}} />));
    // After switch, expanded region should be gone
    expect(screen.queryByText(/no notes link/i)).toBeNull();
    expect(screen.queryByText(/loading…/i)).toBeNull();
  });

  it("OutgoingLinksPanel collapses when noteId changes", () => {
    const { rerender } = render(wrap(<OutgoingLinksPanel noteId="a" onNavigate={() => {}} />));
    fireEvent.click(screen.getByRole("button", { name: /links/i }));
    rerender(wrap(<OutgoingLinksPanel noteId="b" onNavigate={() => {}} />));
    // Expanded content should no longer be present
    expect(screen.queryByText(/loading…/i)).toBeNull();
  });
});
