import { get, set, del, clear } from "idb-keyval";
import { experimental_createQueryPersister } from "@tanstack/query-persist-client-core";

// Fine-grained per-query persistence to IndexedDB. Cached results render
// instantly on reload — including with no network — and are replaced when a
// fresh fetch succeeds. The service worker never caches data requests; this
// persister is the single owner of data caching.
export const queryPersister = experimental_createQueryPersister({
  storage: {
    getItem: (key: string) => get<string>(key),
    setItem: (key: string, value: string) => set(key, value),
    removeItem: (key: string) => del(key),
  },
  maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
  // Bump whenever a query's cached data SHAPE changes. Persisted entries are
  // JSON, so a Map/Set that used to be cached comes back as a plain object and
  // crashes callers ("x.get is not a function"). A new buster discards every
  // old entry instead of feeding stale shapes to new code.
  buster: "v2",
});

// Query keys do not include the user id, so cached data must never survive a
// sign-out or account switch.
export async function clearPersistedQueries() {
  await clear();
}
