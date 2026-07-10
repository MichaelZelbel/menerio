import { PowerSyncDatabase } from "@powersync/web";
import { AppSchema } from "./schema";

let instance: PowerSyncDatabase | null = null;

// Lazy singleton: constructing PowerSyncDatabase spins up the wa-sqlite wasm
// worker, so it must only happen on OFFLINE_CORE sessions — callers are all
// behind that flag.
export function getDb(): PowerSyncDatabase {
  if (!instance) {
    instance = new PowerSyncDatabase({
      schema: AppSchema,
      database: { dbFilename: "menerio.db" },
    });
    // Console access for debugging/support:
    //   localStorage.setItem("menerio:offline-core-debug", "true")
    if (
      import.meta.env.DEV ||
      localStorage.getItem("menerio:offline-core-debug") === "true"
    ) {
      (window as unknown as Record<string, unknown>).__menerioDb = instance;
    }
  }
  return instance;
}
