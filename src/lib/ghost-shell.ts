/**
 * Ghost-shell self-heal for the service worker.
 *
 * If a service worker installs while the CDN is still propagating a deploy, it
 * can freeze a stale index.html into its precache and then report "up to date"
 * forever: the app keeps running a build that no longer exists (observed live
 * 2026-07-12: a page ran a chunk absent from every sw.js manifest). Signature:
 * our own index chunk is missing from the live sw.js, and the browser finds no
 * new worker to install. Remedy: drop the worker and caches and reload.
 *
 * It runs at boot, on every return to the tab and with the update poll, and
 * its loop guard is per stale chunk, not per tab. With one check at boot and a
 * guard of "1" for the whole tab session, a tab that had healed once never
 * healed again: on 2026-09-29 a window still ran the build from before the
 * fact-store switch, and Never Again on a profile fact failed with "Could not
 * find the table 'public.profile_entries'", a table that build still wrote to.
 * A stale build must not keep writing against a newer database.
 *
 * After an ordinary deploy the live sw.js lacks our chunk as well, and there
 * the browser is simply installing the new worker, after which autoUpdate
 * reloads the tab and only the changed files are downloaded. Healing then as
 * well unregistered that worker mid-install, deleted every cache and reloaded
 * a second time, so every open tab downloaded the whole app again on every
 * deploy. So a mismatch first asks the browser for an update, and the heal
 * runs only when there is nothing to install or the install failed.
 */

export const GHOST_SHELL_KEY = "menerio:ghost-shell-healed";

/** How long a normal update may take to install before this round gives up (the precache holds the multi-megabyte sync engine). */
export const UPDATE_SETTLE_MS = 2 * 60 * 1000;

type Worker = Pick<ServiceWorker, "state" | "addEventListener" | "removeEventListener">;
type Registration = {
  active: Worker | null;
  installing: Worker | null;
  waiting: Worker | null;
  update: () => Promise<unknown>;
};

export interface GhostShellDeps {
  /** Our own entry chunk, e.g. "index-AbC123.js", or undefined when it cannot be found. */
  ownChunk: string | undefined;
  getRegistration: () => Promise<Registration | undefined | null>;
  /** The live /sw.js text, or null when it could not be fetched. */
  fetchManifest: () => Promise<string | null>;
  /** Unregister every worker and delete every cache. */
  dropWorkersAndCaches: () => Promise<void>;
  reload: () => void;
  storage: Pick<Storage, "getItem" | "setItem">;
  settleMs?: number;
}

export type HealOutcome = "skipped" | "current" | "updating" | "guarded" | "healed";

export function createGhostShellHealer(deps: GhostShellDeps): () => Promise<HealOutcome> {
  let healing = false;
  return async () => {
    if (healing) return "skipped";
    healing = true;
    try {
      const { ownChunk } = deps;
      if (!ownChunk) return "skipped";
      const reg = await deps.getRegistration();
      if (!reg?.active) return "skipped";
      const manifest = await deps.fetchManifest();
      // A manifest without any index chunk is not a real sw.js (an error page).
      if (!manifest || !/assets\/index-[\w-]+\.js/.test(manifest)) return "skipped";
      if (manifest.includes(ownChunk)) return "current";

      const activeBefore = reg.active;
      await reg.update().catch(() => {});
      // A new worker already took over: autoUpdate reloads the tab.
      if (reg.active !== activeBefore) return "updating";
      const incoming = reg.installing ?? reg.waiting;
      if (incoming) {
        const outcome = await settle(incoming, deps.settleMs ?? UPDATE_SETTLE_MS);
        // Activated: autoUpdate reloads the tab. Still installing: next round.
        // Only a failed install (redundant) falls through to the heal.
        if (outcome !== "redundant") return "updating";
      }

      // Once per stale build: the reload may land on the same stale shell
      // while the CDN is still inconsistent, and must not loop.
      if (deps.storage.getItem(GHOST_SHELL_KEY) === ownChunk) return "guarded";
      deps.storage.setItem(GHOST_SHELL_KEY, ownChunk);
      await deps.dropWorkersAndCaches();
      deps.reload();
      return "healed";
    } catch {
      // Self-heal must never break the app.
      return "skipped";
    } finally {
      healing = false;
    }
  };
}

function settle(worker: Worker, ms: number): Promise<"activated" | "redundant" | "pending"> {
  return new Promise((resolve) => {
    const done = (value: "activated" | "redundant" | "pending") => {
      clearTimeout(timer);
      worker.removeEventListener("statechange", check);
      resolve(value);
    };
    const check = () => {
      if (worker.state === "activated" || worker.state === "redundant") done(worker.state);
    };
    const timer = setTimeout(() => done("pending"), ms);
    worker.addEventListener("statechange", check);
    check();
  });
}
