import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { queryPersister } from "@/lib/query-persister";

// Cross-window cache sync. When a mutation invalidates a query in one browser
// window (e.g. the main Notes view), other windows of the same app (e.g. a
// popped-out note) must drop their stale cached copy and refetch — otherwise
// they render the pre-edit version until React Query's staleTime elapses.

const CHANNEL_NAME = "menerio-query-sync";
const STORAGE_FALLBACK_KEY = "menerio.querySync";

interface InvalidateMessage {
  type: "invalidate";
  keys: QueryKey[];
  ts: number;
  origin: string;
}

// Unique per-window id so we ignore our own broadcasts.
const originId =
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;

function getChannel(): BroadcastChannel | null {
  if (typeof window === "undefined") return null;
  if (typeof BroadcastChannel === "undefined") return null;
  try {
    return new BroadcastChannel(CHANNEL_NAME);
  } catch {
    return null;
  }
}

let channel: BroadcastChannel | null = null;
function ensureChannel(): BroadcastChannel | null {
  if (channel) return channel;
  channel = getChannel();
  return channel;
}

function postViaStorage(msg: InvalidateMessage) {
  try {
    // Writing then removing triggers the 'storage' event in other tabs.
    localStorage.setItem(STORAGE_FALLBACK_KEY, JSON.stringify(msg));
    localStorage.removeItem(STORAGE_FALLBACK_KEY);
  } catch {
    // ignore quota / disabled storage
  }
}

/**
 * Broadcast a set of query-key invalidations to every other window of this
 * app. The current window is NOT affected — callers should invalidate their
 * own QueryClient separately (React Query mutation hooks already do this).
 */
export function broadcastInvalidation(keys: QueryKey[]) {
  if (typeof window === "undefined") return;
  const msg: InvalidateMessage = {
    type: "invalidate",
    keys,
    ts: Date.now(),
    origin: originId,
  };
  const ch = ensureChannel();
  if (ch) {
    try {
      ch.postMessage(msg);
      return;
    } catch {
      // fall through to storage fallback
    }
  }
  postViaStorage(msg);
}

async function removePersistedForKeys(qc: QueryClient, keys: QueryKey[]) {
  // Drop persisted (IndexedDB) copies so a cold reload of this window doesn't
  // paint the stale note before the refetch resolves.
  const cache = qc.getQueryCache();
  const removals: Promise<unknown>[] = [];
  for (const key of keys) {
    const matches = cache.findAll({ queryKey: key });
    for (const q of matches) {
      try {
        removals.push(Promise.resolve(queryPersister.persisterFn(q).removeClient?.()));
      } catch {
        // best-effort
      }
    }
  }
  await Promise.allSettled(removals);
}

function handleMessage(qc: QueryClient, msg: InvalidateMessage) {
  if (!msg || msg.type !== "invalidate") return;
  if (msg.origin === originId) return;
  for (const key of msg.keys) {
    qc.invalidateQueries({ queryKey: key });
  }
  void removePersistedForKeys(qc, msg.keys);
}

/**
 * Install the cross-window listener. Returns a cleanup function.
 * Safe to call multiple times; subsequent calls no-op.
 */
let installed = false;
export function installQuerySyncListener(qc: QueryClient): () => void {
  if (typeof window === "undefined") return () => {};
  if (installed) return () => {};
  installed = true;

  const ch = ensureChannel();
  const onChannel = (event: MessageEvent<InvalidateMessage>) => {
    handleMessage(qc, event.data);
  };
  ch?.addEventListener("message", onChannel);

  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_FALLBACK_KEY || !event.newValue) return;
    try {
      handleMessage(qc, JSON.parse(event.newValue) as InvalidateMessage);
    } catch {
      // ignore parse errors
    }
  };
  window.addEventListener("storage", onStorage);

  return () => {
    ch?.removeEventListener("message", onChannel);
    window.removeEventListener("storage", onStorage);
    installed = false;
  };
}
