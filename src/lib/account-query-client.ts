import { QueryClient, type QueryKey } from "@tanstack/react-query";
import { createAccountPersister } from "./query-persister";

/** Appended so existing resource-prefix invalidations keep matching. */
export function privateQueryKey(accountId: string | null, key: QueryKey): QueryKey {
  const tail = key[key.length - 1];
  if (tail && typeof tail === "object" && "__account" in tail) {
    if (tail.__account !== accountId) throw new Error("Query belongs to another account");
    return key;
  }
  return [...key, { __account: accountId }];
}

/** One immutable owner per client, including callbacks retained by old mutations. */
export function createAccountQueryClient(accountId: string | null) {
  const persistence = createAccountPersister(accountId);
  const client = new QueryClient({ defaultOptions: { queries: {
    staleTime: 5 * 60 * 1000, gcTime: 24 * 60 * 60 * 1000,
    refetchOnWindowFocus: false, retry: 1, networkMode: "offlineFirst",
    persister: persistence.persisterFn,
  } } });
  const defaults = client.defaultQueryOptions.bind(client);
  // This is the common boundary for observers, fetches, and imperative get/set.
  // Do not trust caller-supplied hashes or _defaulted options from another client.
  client.defaultQueryOptions = ((options: any) => defaults({
    ...options, queryKey: privateQueryKey(accountId, options.queryKey),
    queryHash: undefined, _defaulted: false,
  })) as typeof client.defaultQueryOptions;
  return { client, retire: async () => {
    const flushed = persistence.retire();
    await client.cancelQueries();
    await flushed;
    client.clear();
  } };
}
