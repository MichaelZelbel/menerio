import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import type { createFakeSupabase, RecordedQuery } from "@/test/fake-supabase";
import { WikilinkAutocomplete } from "../WikilinkAutocomplete";

// Regressions from the notes review of 2026-09-29:
// - Enter/Tab while the 150 ms debounced search was pending linked whatever
//   note topped the previous query's list ("[[Budget" + Enter linked a
//   recent, unrelated note).
// - A failed search read "No notes found" and offered Create, inviting a
//   duplicate of a note that exists.

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

const RECENT = { id: "n-recent", title: "Grocery list", metadata: null, updated_at: "2026-09-28T10:00:00Z" };
const BUDGET = { id: "n-budget", title: "Budget 2026", metadata: null, updated_at: "2026-09-01T10:00:00Z" };

const searchedFor = (q: RecordedQuery) => q.filters.some(([op]) => op === "or");

function mount() {
  const onSelect = vi.fn();
  const onCreate = vi.fn();
  const onClose = vi.fn();
  render(
    <WikilinkAutocomplete
      isOpen
      onClose={onClose}
      onSelect={onSelect}
      onCreate={onCreate}
      position={{ top: 0, left: 0 }}
    />,
  );
  return { onSelect, onCreate, onClose, input: screen.getByLabelText("Search notes") };
}

beforeEach(() => {
  fake.current!.reset();
  respond.fn = (q) => (searchedFor(q) ? { data: [BUDGET] } : { data: [RECENT] });
});
afterEach(cleanup);

describe("WikilinkAutocomplete", () => {
  it("Enter pressed before the search catches up links the fresh top result, not the stale one", async () => {
    const { onSelect, onClose, input } = mount();
    await screen.findByText("Grocery list");

    fireEvent.change(input, { target: { value: "Budget" } });
    fireEvent.keyDown(input, { key: "Enter" });

    // Nothing is linked from the list still showing the previous query.
    expect(onSelect).not.toHaveBeenCalled();

    await waitFor(() => expect(onSelect).toHaveBeenCalledTimes(1));
    expect(onSelect).toHaveBeenCalledWith("Budget 2026", "n-budget");
    expect(onClose).toHaveBeenCalled();
  });

  it("Tab pressed before the search catches up waits for the fresh results too", async () => {
    const { onSelect, input } = mount();
    await screen.findByText("Grocery list");

    fireEvent.change(input, { target: { value: "Budget" } });
    fireEvent.keyDown(input, { key: "Tab" });
    expect(onSelect).not.toHaveBeenCalled();

    await waitFor(() => expect(onSelect).toHaveBeenCalledWith("Budget 2026", "n-budget"));
  });

  it("Enter on settled results still picks the highlighted row", async () => {
    const { onSelect, input } = mount();
    fireEvent.change(input, { target: { value: "Budget" } });
    await screen.findByText("Budget 2026");

    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith("Budget 2026", "n-budget");
  });

  it("a failed search says so and offers no Create row", async () => {
    respond.fn = (q) => (searchedFor(q) ? { error: { message: "JWT expired", code: "PGRST301" } } : { data: [RECENT] });
    const { onCreate, onSelect, input } = mount();
    await screen.findByText("Grocery list");

    fireEvent.change(input, { target: { value: "Budget" } });
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not search your notes");
    expect(screen.queryByText(/JWT/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Create:/)).not.toBeInTheDocument();
    expect(screen.queryByText("No notes found")).not.toBeInTheDocument();

    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCreate).not.toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("offers Create once a successful search finds no exact title", async () => {
    respond.fn = (q) => (searchedFor(q) ? { data: [] } : { data: [RECENT] });
    const { onCreate, input } = mount();
    fireEvent.change(input, { target: { value: "Brand new idea" } });
    await screen.findByText(/Create: "Brand new idea"/);

    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCreate).toHaveBeenCalledWith("Brand new idea");
  });
});
