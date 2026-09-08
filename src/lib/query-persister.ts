import { get, set, del, keys, delMany } from "idb-keyval";
import { experimental_createQueryPersister } from "@tanstack/query-persist-client-core";

export function createAccountPersister(accountId: string | null) {
  let active = true;
  const writes = new Set<Promise<void>>();
  const prefix = `menerio:queries:v3:${encodeURIComponent(accountId ?? "anonymous")}:`;
  const persister = experimental_createQueryPersister({
    storage: {
      getItem: async (key: string) => active && accountId ? get<string>(prefix + key) : undefined,
      setItem: async (key: string, value: string) => {
        if (active && accountId) {
          const write = set(prefix + key, value);
          writes.add(write);
          try { await write; } finally { writes.delete(write); }
        }
      },
      removeItem: (key: string) => del(prefix + key),
    },
    maxAge: 1000 * 60 * 60 * 24 * 7,
    buster: "account-v3",
  });
  return { ...persister, retire: async () => { active = false; await Promise.allSettled([...writes]); } };
}

// Delete only this feature's cache, never other IndexedDB consumers.
export async function clearPersistedQueries(accountId?: string) {
  const prefix = accountId ? `menerio:queries:v3:${encodeURIComponent(accountId)}:` : "menerio:queries:";
  const cacheKeys = (await keys()).filter(key => typeof key === "string" &&
    (key.startsWith(prefix) || key.startsWith("tanstack-query-")));
  await delMany(cacheKeys);
}
