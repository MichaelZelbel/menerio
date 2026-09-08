import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useQuery } from "@tanstack/react-query";
import { AuthProvider, useAuth } from "./AuthContext";
const mocks = vi.hoisted(() => ({
  callback: undefined as undefined | ((event: string, session: any) => void),
  profileResolvers: new Map<string, (v: any) => void>(),
  roleResolvers: new Map<string, (v: any) => void>(),
  fetch: vi.fn(),
}));
vi.mock("@/lib/flags", () => ({ OFFLINE_CORE: false }));
vi.mock("@/sync/db", () => ({ getDb: vi.fn() }));
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
beforeEach(() => { mocks.fetch.mockReset().mockImplementation(async id => `${id}-group`); mocks.profileResolvers.clear(); mocks.roleResolvers.clear(); });
afterEach(cleanup);
describe("AuthProvider account changes", () => {
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
