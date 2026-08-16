import { useSyncExternalStore } from "react";
import { OFFLINE_CORE } from "@/lib/flags";

/**
 * Whether background sync is actually working, and what the app should do about
 * it right now.
 *
 * WHY THIS EXISTS. Before it, a dead sync stream was invisible. `SyncManager`
 * reported a failed connect through `console.warn`, which the production build
 * strips (`vite.config.ts`, `drop: ["console"]`), it tried exactly once per page
 * load with no retry, and the Notes screen read local SQLite unconditionally. So
 * when the PowerSync instance was deleted, every local-first device kept
 * rendering a frozen copy of the database and said nothing at all. The note list
 * looked completely normal while being hours or weeks out of date.
 *
 * Two things follow from that and both live here: the state is readable by the
 * UI so it can be shown, and it decides where reads and writes go, so a device
 * with no sync falls back to talking to the server directly instead of quietly
 * serving stale data forever.
 */
export type SyncHealthState =
  /** Not a local-first device. Reads and writes already go straight to the server. */
  | "off"
  /** Connecting. The local copy is shown meanwhile, which is the point of having it. */
  | "starting"
  /** The stream is connected and the local copy is being kept current. */
  | "live"
  /** The sync service did not answer. The local copy cannot be trusted to be current. */
  | "unreachable";

export type SyncHealth = {
  state: SyncHealthState;
  /** A sentence a person can act on, never a raw stack. */
  error: string | null;
  /** Local writes that have not reached the server. Data-loss risk if ignored. */
  pendingUploads: number;
};

const initial: SyncHealth = {
  state: OFFLINE_CORE ? "starting" : "off",
  error: null,
  pendingUploads: 0,
};

let health: SyncHealth = initial;
const listeners = new Set<() => void>();

export function getSyncHealth(): SyncHealth {
  return health;
}

/**
 * Replace the identity of the stored object ONLY when something really changed.
 * useSyncExternalStore compares snapshots by reference and re-renders on every
 * new one, so returning a fresh object each call is an infinite render loop.
 */
export function setSyncHealth(next: Partial<SyncHealth>): void {
  const merged: SyncHealth = { ...health, ...next };
  if (
    merged.state === health.state &&
    merged.error === health.error &&
    merged.pendingUploads === health.pendingUploads
  ) {
    return;
  }
  health = merged;
  listeners.forEach((listener) => listener());
}

/** The store half of useSyncExternalStore. Exported so it can be tested directly. */
export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useSyncHealth(): SyncHealth {
  return useSyncExternalStore(subscribe, getSyncHealth, getSyncHealth);
}

/**
 * Should this read or write go through the local database?
 *
 * "starting" counts as yes: showing the local copy immediately is the whole
 * reason it exists, and a slow connect must not push every device onto the
 * network path. Only a service that has been shown not to answer flips this,
 * and then reads and writes BOTH move to the server together. They have to move
 * together: reading from the server while writing to a local queue that can
 * never drain would make a person's own edit disappear as they typed it.
 */
export function shouldUseLocalFirst({
  offlineCore,
  state,
  online,
}: {
  offlineCore: boolean;
  state: SyncHealthState;
  online: boolean;
}): boolean {
  if (!offlineCore) return false;
  // Only a service that is missing while the network is fine sends reads to the
  // server. Everything else stays local.
  return !(state === "unreachable" && online);
}

export function isLocalFirstActive(): boolean {
  return shouldUseLocalFirst({
    offlineCore: OFFLINE_CORE,
    state: health.state,
    online: isOnline(),
  });
}

/** The reactive twin of isLocalFirstActive, for components and hooks. */
export function useLocalFirstActive(): boolean {
  const { state } = useSyncHealth();
  return shouldUseLocalFirst({
    offlineCore: OFFLINE_CORE,
    state,
    online: isOnline(),
  });
}

/**
 * A device with no network stays on its local copy, always.
 *
 * Falling back to the server because sync is down is right when the network is
 * there and only the sync service is missing. Doing it on a train would throw
 * away the entire point of holding a local copy: reads would go to a server that
 * cannot be reached either, and a working offline app would turn into an error
 * message. Offline is the one case where the frozen local copy IS the right
 * answer, and the offline pill already says so.
 */
function isOnline(): boolean {
  return typeof navigator === "undefined" || navigator.onLine !== false;
}

/** Test seam. Resets the module back to how it loads. */
export function resetSyncHealth(): void {
  health = initial;
  listeners.forEach((listener) => listener());
}
