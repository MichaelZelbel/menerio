import { PowerSyncContext } from "@powersync/react";
import { OFFLINE_CORE } from "@/lib/flags";
import { getDb } from "./db";

// Mounts the PowerSync context only on OFFLINE_CORE sessions so the wasm
// worker never starts for users on the default online path.
export function MaybePowerSyncProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!OFFLINE_CORE) return <>{children}</>;
  return (
    <PowerSyncContext.Provider value={getDb()}>
      {children}
    </PowerSyncContext.Provider>
  );
}
