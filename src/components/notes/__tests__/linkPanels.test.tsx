import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { createFakeSupabase, RecordedQuery } from "@/test/fake-supabase";
import { BacklinksPanel } from "../BacklinksPanel";
import { OutgoingLinksPanel } from "../OutgoingLinksPanel";

// Regressions from the notes review of 2026-09-29:
// - Both panels ignored query errors, so a failed read said "no links".
// - Backlinks fetched the full body of every linking note for its snippet,
//   even while the panel was collapsed.

const fake = vi.hoisted(() => ({ current: null as ReturnType<typeof createFakeSupabase> | null }));
const respond = vi.hoisted(() => ({
  fn: (_q: RecordedQuery): { data?: unknown; error?: unknown } | undefined => undefined,
}));

vi.mock("@/integrations/supabase/client", async () => {
  const { createFakeSupabase } = await import("@/test/fake-supabase");
  fake.current = createFakeSupabase((q) => respond.fn(q));
  return { supabase: fake.current.client };
});

const auth = vi.hoisted(() => ({ user: { id: "u1" } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => auth }));

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

const failure = { message: 'relation "note_connections" does not exist', code: "42P01" };

beforeEach(() => {
  fake.current!.reset();
  window.localStorage.clear();
});
afterEach(cleanup);

describe("link panels", () => {
  it("Backlinks says the read failed instead of 'no links'", async () => {
    window.localStorage.setItem("menerio.panelPrefs.note-backlinks", "true");
    respond.fn = (q) => (q.table === "note_connections" ? { error: failure } : undefined);
    wrap(<BacklinksPanel noteId="n1" onNavigate={() => {}} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load the notes that link here.");
    expect(screen.queryByText(/No notes link to this one yet/)).not.toBeInTheDocument();
    expect(screen.queryByText(/relation/)).not.toBeInTheDocument();
  });

  it("Outgoing links says the read failed instead of 'no links'", async () => {
    window.localStorage.setItem("menerio.panelPrefs.note-links", "true");
    respond.fn = (q) => (q.table === "note_connections" ? { error: failure } : undefined);
    wrap(<OutgoingLinksPanel noteId="n1" onNavigate={() => {}} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load the notes this one links to.");
    expect(screen.queryByText(/doesn't link to any other notes yet/)).not.toBeInTheDocument();
  });

  it("Backlinks fetches note bodies for snippets only once expanded", async () => {
    respond.fn = (q) => {
      if (q.table === "note_connections") return { data: [{ source_note_id: "s1" }] };
      if (q.table === "notes" && q.columns === "id, title, updated_at")
        return { data: [{ id: "s1", title: "Linking note", updated_at: "2026-09-01T10:00:00Z" }] };
      if (q.table === "notes" && q.columns === "id, content")
        return { data: [{ id: "s1", content: "Before the link [[Target]] and after" }] };
      return undefined;
    };
    wrap(<BacklinksPanel noteId="n1" onNavigate={() => {}} />);

    // Collapsed: the count loads, no body is read.
    expect(await screen.findByRole("button", { name: "Backlinks (1)" })).toBeInTheDocument();
    expect(fake.current!.on("notes").map((q) => q.columns)).toEqual(["id, title, updated_at"]);

    fireEvent.click(screen.getByRole("button", { name: "Backlinks (1)" }));
    expect(await screen.findByText(/Before the link \[\[Target\]\] and after/)).toBeInTheDocument();
    await waitFor(() =>
      expect(fake.current!.on("notes").map((q) => q.columns)).toContain("id, content"),
    );
  });
});
