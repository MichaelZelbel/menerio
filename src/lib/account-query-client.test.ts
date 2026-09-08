import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAccountQueryClient, privateQueryKey } from "./account-query-client";
import { clearPersistedQueries } from "./query-persister";

const disk = vi.hoisted(() => new Map<string, string>());
vi.mock("idb-keyval", () => ({
  get: async (k: string) => disk.get(k), set: async (k: string, v: string) => { disk.set(k, v); },
  del: async (k: string) => { disk.delete(k); }, keys: async () => [...disk.keys()],
  delMany: async (ks: string[]) => { ks.forEach(k => disk.delete(k)); },
}));
beforeEach(() => disk.clear());
const tick = () => new Promise(resolve => setTimeout(resolve, 20));

describe("account query boundary", () => {
  it.each([["contact_group", "friends"], ["note", "bookmarked-id"]])("isolates reused key %j across direct and signed-out transitions", async (...key) => {
    const a = createAccountQueryClient("A");
    await a.client.fetchQuery({ queryKey: key, queryFn: async () => "A private" });
    await a.retire();
    const anonymous = createAccountQueryClient(null);
    expect(anonymous.client.getQueryData(key)).toBeUndefined();
    const b = createAccountQueryClient("B");
    const fetch = vi.fn(async () => "B private");
    expect(await b.client.fetchQuery({ queryKey: key, queryFn: fetch })).toBe("B private");
    expect(fetch).toHaveBeenCalledOnce();
    expect(b.client.getQueryCache().getAll()[0].queryKey.at(-1)).toEqual({ __account: "B" });
  });
  it("keeps optimistic writes and prefix invalidations compatible", async () => {
    const { client } = createAccountQueryClient("A");
    client.setQueryData(["notes", "all"], ["value"]);
    expect(client.getQueryData(["notes", "all"])).toEqual(["value"]);
    await client.invalidateQueries({ queryKey: ["notes"] });
    expect(client.getQueryState(["notes", "all"])?.isInvalidated).toBe(true);
    const [key] = client.getQueriesData({ queryKey: ["notes"] })[0];
    client.setQueryData(key, ["updated"]);
    expect(client.getQueryCache().getAll()).toHaveLength(1);
    expect(() => privateQueryKey("B", key)).toThrow("another account");
  });
  it("late responses and old mutation callbacks cannot populate the new client or disk", async () => {
    const a = createAccountQueryClient("A");
    let resolve!: (v: string) => void;
    const pending = a.client.fetchQuery({ queryKey: ["note", "id"], queryFn: () => new Promise<string>(r => { resolve = r; }) }).catch(() => undefined);
    await tick();
    await a.retire();
    const b = createAccountQueryClient("B");
    resolve("A private");
    await pending;
    a.client.setQueryData(["note", "id"], "A late mutation");
    await tick();
    expect(b.client.getQueryData(["note", "id"])).toBeUndefined();
    expect([...disk.values()].some(v => v.includes("A private"))).toBe(false);
  });
  it("restores offline data only to the same owner across independent tabs and reloads", async () => {
    const a = createAccountQueryClient("A");
    await a.client.fetchQuery({ queryKey: ["group", "friends"], queryFn: async () => "A private" });
    await tick();
    const reloadA = createAccountQueryClient("A");
    const networkA = vi.fn(async () => "network");
    expect(await reloadA.client.fetchQuery({ queryKey: ["group", "friends"], queryFn: networkA })).toBe("A private");
    expect(networkA).not.toHaveBeenCalled();
    const tabB = createAccountQueryClient("B");
    expect(await tabB.client.fetchQuery({ queryKey: ["group", "friends"], queryFn: async () => "B private" })).toBe("B private");
    await tick();
    await clearPersistedQueries("A");
    expect([...disk.keys()].some(k => k.includes(":A:"))).toBe(false);
    expect([...disk.keys()].some(k => k.includes(":B:"))).toBe(true);
  });
});
