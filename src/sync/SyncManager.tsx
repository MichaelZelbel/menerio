import { useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { OFFLINE_CORE } from "@/lib/flags";
import { POWERSYNC_URL } from "./config";
import { getDb } from "./db";
import { SupabaseConnector } from "./connector";
import { isSyncServiceReachable, serviceHost } from "./reachability";
import { setSyncHealth } from "./sync-health";

const POWERSYNC_USER_KEY = "menerio:powersync-user";

// Backoff for a service that is not answering. The last step is five minutes,
// because the realistic causes (an instance that was deleted, a slot that was
// dropped, credentials that expired) are fixed by a person, not by waiting.
const RETRY_SCHEDULE_MS = [15_000, 30_000, 60_000, 300_000];

function describe(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.trim() || "The sync service could not be reached.";
}

// Drives the PowerSync connection lifecycle from auth state. Local reads and
// writes never depend on this — without a connection the local database simply
// doesn't sync — but the app must be TOLD that, which is what sync-health is
// for. Until 2026-08-16 a failed connect was a single console.warn that the
// production build deletes, tried once per page load and never again.
export function SyncManager() {
  const { user, loading } = useAuth();

  useEffect(() => {
    if (!OFFLINE_CORE || loading) return;
    const db = getDb();

    if (!user) {
      if (localStorage.getItem(POWERSYNC_USER_KEY)) {
        // Explicit sign-out (loading is false and there is no session).
        // Offline token-refresh failures do NOT land here: supabase-js keeps
        // the session object; only a real SIGNED_OUT clears `user`.
        localStorage.removeItem(POWERSYNC_USER_KEY);
        db.disconnectAndClear().catch(() => {
          /* nothing to report: the session is already gone */
        });
      }
      return;
    }

    let cancelled = false;
    let attempt = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    // The stream reporting itself connected is the only positive proof of a
    // working sync, so it and nothing else clears the alarm.
    const unregister = db.registerListener({
      statusChanged: (status) => {
        if (cancelled) return;
        if (status?.connected) {
          attempt = 0;
          setSyncHealth({ state: "live", error: null });
        }
      },
    });

    const reportUnreachable = async (message: string) => {
      let pendingUploads = 0;
      try {
        // Named out loud because these are edits that exist only on this device.
        const stats = await db.getUploadQueueStats();
        pendingUploads = (stats as { count?: number })?.count ?? 0;
      } catch {
        /* the queue is a detail; the outage is the headline */
      }
      if (cancelled) return;
      setSyncHealth({ state: "unreachable", error: message, pendingUploads });
    };

    const attemptConnect = async () => {
      if (cancelled) return;
      try {
        const lastUserId = localStorage.getItem(POWERSYNC_USER_KEY);
        if (lastUserId && lastUserId !== user.id) {
          // Different account on this device: local data must not carry over.
          await db.disconnectAndClear();
        }
        localStorage.setItem(POWERSYNC_USER_KEY, user.id);

        if (!POWERSYNC_URL) {
          await reportUnreachable("No sync service is configured for this app.");
          return;
        }

        // Ask whether the host is there BEFORE handing it to connect(), which
        // resolves happily against a service that no longer exists and then
        // retries in the background forever without ever raising anything.
        if (!(await isSyncServiceReachable(POWERSYNC_URL))) {
          await reportUnreachable(
            `The sync service at ${serviceHost(POWERSYNC_URL)} did not answer, so this device is not receiving changes.`,
          );
          scheduleRetry();
          return;
        }

        await db.connect(new SupabaseConnector());
        // Not "live" yet — statusChanged decides that. connect() returning only
        // means the attempt started.
      } catch (error) {
        if (cancelled) return;
        await reportUnreachable(describe(error));
        scheduleRetry();
      }
    };

    const scheduleRetry = () => {
      if (cancelled) return;
      const wait = RETRY_SCHEDULE_MS[Math.min(attempt, RETRY_SCHEDULE_MS.length - 1)];
      attempt += 1;
      retryTimer = setTimeout(() => {
        void attemptConnect();
      }, wait);
    };

    setSyncHealth({ state: "starting", error: null });
    void attemptConnect();

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      unregister?.();
    };
  }, [user, loading]);

  return null;
}
