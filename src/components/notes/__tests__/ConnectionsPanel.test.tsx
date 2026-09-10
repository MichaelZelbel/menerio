import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ConnectionsPanel } from "../ConnectionsPanel";

// Regression for the spend audit of 2026-09-11: opening a note bought one
// find-connections chat completion every time. The panel now keeps the result
// per note per calendar day in localStorage; only the manual buttons refetch.

const invokeMock = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: { access_token: "fixture" } } }) },
    functions: { invoke: (...args: unknown[]) => invokeMock(...args) },
  },
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "u1" } }),
}));

const CACHE_KEY = "menerio-note-connections:n1";

const payload = (insight: string) => ({
  connections: [{ id: "n2", title: "Other note", similarity: 0.8, metadata: null, created_at: "2026-09-11" }],
  related_contacts: [],
  related_actions: [],
  insight,
});

const mount = (noteId = "n1") =>
  render(
    <MemoryRouter>
      <ConnectionsPanel noteId={noteId} />
    </MemoryRouter>,
  );

beforeEach(() => {
  window.localStorage.clear();
  invokeMock.mockReset();
  invokeMock.mockResolvedValue({ data: payload("First insight"), error: null });
});
afterEach(cleanup);

describe("ConnectionsPanel daily cache", () => {
  it("calls find-connections once and serves the next open of the same note from localStorage", async () => {
    const first = mount();
    await screen.findByText("First insight");
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock.mock.calls[0][0]).toBe("find-connections");
    first.unmount();

    invokeMock.mockResolvedValue({ data: payload("Second insight"), error: null });
    mount();
    expect(await screen.findByText("First insight")).toBeInTheDocument();
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it("refresh button bypasses the cache and overwrites it with the fresh result", async () => {
    mount();
    await screen.findByText("First insight");

    invokeMock.mockResolvedValue({ data: payload("Second insight"), error: null });
    fireEvent.click(screen.getByRole("button", { name: /refresh connections/i }));
    await screen.findByText("Second insight");

    expect(invokeMock).toHaveBeenCalledTimes(2);
    const stored = JSON.parse(window.localStorage.getItem(CACHE_KEY) ?? "null");
    expect(stored.data.insight).toBe("Second insight");
    expect(stored.date).toBe(new Date().toDateString());
  });

  it("ignores a cache entry written on another day", async () => {
    window.localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ date: "Wed Sep 09 2020", data: payload("Stale insight") }),
    );
    mount();
    await screen.findByText("First insight");
    expect(screen.queryByText("Stale insight")).not.toBeInTheDocument();
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it("ignores a malformed cache entry", async () => {
    window.localStorage.setItem(CACHE_KEY, "{not json");
    mount();
    await screen.findByText("First insight");
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it("caches per note, so a different note still fetches", async () => {
    const first = mount("n1");
    await screen.findByText("First insight");
    first.unmount();

    mount("n2");
    await screen.findByText("First insight");
    expect(invokeMock).toHaveBeenCalledTimes(2);
    expect(invokeMock.mock.calls[1][1]).toMatchObject({ body: { note_id: "n2" } });
  });

  it("does not cache a failed call, so Retry still refetches", async () => {
    invokeMock.mockResolvedValue({ data: null, error: { message: "boom" } });
    mount();
    await screen.findByText("Failed to find connections");
    expect(window.localStorage.getItem(CACHE_KEY)).toBeNull();

    invokeMock.mockResolvedValue({ data: payload("Recovered insight"), error: null });
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    await screen.findByText("Recovered insight");
    expect(invokeMock).toHaveBeenCalledTimes(2);
  });
});
