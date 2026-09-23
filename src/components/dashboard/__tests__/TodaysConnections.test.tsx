import { render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  invoke: vi.fn(),
  auth: { user: { id: "u1" } },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => state.auth }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: { access_token: "t" } } }) },
    functions: { invoke: state.invoke },
  },
}));
import { TodaysConnections } from "../TodaysConnections";

beforeEach(() => {
  localStorage.clear();
  state.invoke.mockReset();
});

describe("TodaysConnections", () => {
  it("asks find-connections once a day even when today's answer is empty", async () => {
    state.invoke.mockResolvedValue({ data: { connections: [], insight: null }, error: null });

    const first = render(<MemoryRouter><TodaysConnections /></MemoryRouter>);
    await waitFor(() => expect(state.invoke).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(localStorage.getItem("menerio-daily-connections-date:u1")).toBe(new Date().toDateString()));
    first.unmount();

    // A second Dashboard visit the same day reads the cached "nothing today".
    const second = render(<MemoryRouter><TodaysConnections /></MemoryRouter>);
    await new Promise((r) => setTimeout(r, 20));
    expect(state.invoke).toHaveBeenCalledTimes(1);
    expect(second.container.textContent).toBe("");
  });
});
