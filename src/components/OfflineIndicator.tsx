import { AlertTriangle, WifiOff } from "lucide-react";
import { useOnline } from "@/hooks/use-online";
import { useSyncHealth } from "@/sync/sync-health";

/**
 * The one place the app admits it is not showing current data.
 *
 * Two different problems share this slot because they mean the same thing to a
 * person: what you are looking at may be out of date.
 *
 * - Offline: the device has no network. Expected, temporary, nothing to do.
 * - Not syncing: the device is online but the sync service did not answer. That
 *   one used to be completely silent — a failed connect was a console.warn that
 *   the production build strips — so a deleted sync service looked exactly like
 *   a healthy app, for weeks. Reads now fall back to the server, so the list is
 *   current again, but anything written on this device while it was frozen is
 *   still only on this device, which is what `pendingUploads` is saying.
 */
export function OfflineIndicator() {
  const online = useOnline();
  const sync = useSyncHealth();

  if (!online) {
    return (
      <Pill>
        <WifiOff className="h-3.5 w-3.5 shrink-0" />
        <span>Offline — showing saved data</span>
      </Pill>
    );
  }

  if (sync.state !== "unreachable") return null;

  return (
    <Pill tone="warning">
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
      <span>
        Not syncing — reading from the server
        {sync.pendingUploads > 0 && (
          <>
            {" · "}
            {sync.pendingUploads} change{sync.pendingUploads === 1 ? "" : "s"} still only on
            this device
          </>
        )}
      </span>
    </Pill>
  );
}

function Pill({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "warning";
}) {
  const toneClasses =
    tone === "warning"
      ? "border-destructive/40 bg-destructive/10 text-foreground"
      : "border-border bg-secondary text-secondary-foreground";

  return (
    <div className="fixed bottom-4 left-1/2 z-50 max-w-[92vw] -translate-x-1/2">
      <div
        role="status"
        className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs shadow-lg ${toneClasses}`}
      >
        {children}
      </div>
    </div>
  );
}
