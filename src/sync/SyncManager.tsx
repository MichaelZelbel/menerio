import { useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { OFFLINE_CORE } from "@/lib/flags";
import { POWERSYNC_URL } from "./config";
import { getDb } from "./db";
import { SupabaseConnector } from "./connector";

const POWERSYNC_USER_KEY = "menerio:powersync-user";

// Drives the PowerSync connection lifecycle from auth state. Local reads and
// writes never depend on this — without a connection (offline, or no
// POWERSYNC_URL configured yet) the local database simply doesn't sync.
export function SyncManager() {
  const { user, loading } = useAuth();

  useEffect(() => {
    if (!OFFLINE_CORE || loading) return;
    const db = getDb();

    if (user) {
      const run = async () => {
        const lastUserId = localStorage.getItem(POWERSYNC_USER_KEY);
        if (lastUserId && lastUserId !== user.id) {
          // Different account on this device: local data must not carry over.
          await db.disconnectAndClear();
        }
        localStorage.setItem(POWERSYNC_USER_KEY, user.id);
        if (POWERSYNC_URL) {
          await db.connect(new SupabaseConnector());
        }
      };
      run().catch((error) => {
        console.warn("PowerSync connect failed", error);
      });
    } else if (localStorage.getItem(POWERSYNC_USER_KEY)) {
      // Explicit sign-out (loading is false and there is no session).
      // Offline token-refresh failures do NOT land here: supabase-js keeps
      // the session object; only a real SIGNED_OUT clears `user`.
      localStorage.removeItem(POWERSYNC_USER_KEY);
      getDb()
        .disconnectAndClear()
        .catch((error) => console.warn("PowerSync clear failed", error));
    }
  }, [user, loading]);

  return null;
}
