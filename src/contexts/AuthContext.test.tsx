import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useQuery } from "@tanstack/react-query";
import { AuthProvider, useAuth } from "./AuthContext";
const mocks = vi.hoisted(() => ({
  callback: undefined as undefined | ((event: string, session: any) => void),
  profileResolvers: new Map<string, (v: any) => void>(),
  roleResolvers: new Map<string, (v: any) => void>(),
  fetch: vi.fn(),
  offline: false,
  preserve: vi.fn(),
  clearDb: vi.fn(),
}));
vi.mock("@/lib/flags", () => ({ get OFFLINE_CORE() { return mocks.offline; } }));
vi.mock("@/sync/db", () => ({ getDb: () => ({ disconnectAndClear: mocks.clearDb }) }));
vi.mock("@/sync/recovery", () => ({ preserveUploadsBeforeAccountClear: mocks.preserve }));
vi.mock("@/lib/query-sync", () => ({ installQuerySyncListener: () => () => {} }));
vi.mock("idb-keyval", () => ({ get: async () => undefined, set: async () => {}, del: async () => {}, keys: async () => [], delMany: async () => {} }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  auth: {
    onAuthStateChange: (cb: any) => { mocks.callback = cb; return { data: { subscription: { unsubscribe() {} } } }; },
    getSession: async () => ({ data: { session: null } }),
  },
  from: (table: string) => ({ select: () => ({ eq: (_: string, id: string) => ({ single: () => new Promise(resolve => {
    (table === "profiles" ? mocks.profileResolvers : mocks.roleResolvers).set(id, resolve);
  }) }) }) }),
} }));
function Content() {
  const { user, profile, role } = useAuth();
  const q = useQuery({ queryKey: ["group", "friends"], enabled: !!user, queryFn: () => mocks.fetch(user?.id) });
  return <div>{user?.id ?? "anonymous"}|{profile?.display_name ?? "no-profile"}|{role ?? "no-role"}|{q.data ?? "no-group"}</div>;
}
async function login(id: string | null, event = "SIGNED_IN") {
  await act(async () => { mocks.callback!(event, id ? { user: { id } } : null); });
}
beforeEach(() => { mocks.offline = false; mocks.preserve.mockReset().mockResolvedValue(undefined); mocks.clearDb.mockReset().mockResolvedValue(undefined); localStorage.clear(); mocks.fetch.mockReset().mockImplementation(async id => `${id}-group`); mocks.profileResolvers.clear(); mocks.roleResolvers.clear(); });
afterEach(cleanup);
describe("AuthProvider account changes", () => {
  it("waits for recoverable uploads before clearing the previous account database", async () => {
    render(<AuthProvider><Content /></AuthProvider>);
    await screen.findByText(/anonymous/);
    await login("A");
    await screen.findByText(/A-group/);
    mocks.offline = true;
    localStorage.setItem("menerio:powersync-user", "A");
    let release!: () => void;
    mocks.preserve.mockImplementation(() => new Promise<void>(resolve => { release = resolve; }));
    await login("B");
    expect(mocks.preserve).toHaveBeenCalledWith("A");
    expect(mocks.clearDb).not.toHaveBeenCalled();
    expect(screen.queryByText(/B-group/)).toBeNull();
    await act(async () => { release(); });
    await screen.findByText(/B-group/);
    expect(mocks.clearDb).toHaveBeenCalledOnce();
  });

  it("keeps the old database intact if upload preservation cannot commit", async () => {
    render(<AuthProvider><Content /></AuthProvider>);
    await screen.findByText(/anonymous/);
    await login("A");
    await screen.findByText(/A-group/);
    mocks.offline = true;
    localStorage.setItem("menerio:powersync-user", "A");
    mocks.preserve.mockRejectedValue(new Error("storage failure"));
    await login("B");
    await screen.findByText(/Your account could not be opened safely/);
    expect(mocks.clearDb).not.toHaveBeenCalled();
    expect(screen.queryByText(/A-group|B-group/)).toBeNull();
  });

  it.each([false, true])("clears profile, role and reused group on account switch (signout=%s)", async signout => {
    render(<AuthProvider><Content /></AuthProvider>);
    await screen.findByText(/anonymous/);
    await login("A");
    await screen.findByText(/A-group/);
    if (signout) { await login(null, "SIGNED_OUT"); await screen.findByText(/anonymous/); }
    await login("B");
    await screen.findByText(/B-group/);
    await act(async () => {
      mocks.profileResolvers.get("A")!({ data: { id: "A", display_name: "A-secret" } });
      mocks.roleResolvers.get("A")!({ data: { role: "admin" } });
    });
    expect(screen.queryByText(/A-secret|admin|A-group/)).toBeNull();
    await act(async () => {
      mocks.profileResolvers.get("B")!({ data: { id: "B", display_name: "B-name" } });
      mocks.roleResolvers.get("B")!({ data: { role: "free" } });
    });
    await screen.findByText(/B-name\|free\|B-group/);
  });
  it("preserves the same account cache on token refresh", async () => {
    render(<AuthProvider><Content /></AuthProvider>);
    await screen.findByText(/anonymous/);
    await login("A");
    await screen.findByText(/A-group/);
    await login("A", "TOKEN_REFRESHED");
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(1));
    expect(screen.getByText(/A-group/)).toBeTruthy();
  });
});
