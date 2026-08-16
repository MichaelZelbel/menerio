import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { OFFLINE_CORE } from "@/lib/flags";
import { getReplicaDiagnostics, repairLocalReplica } from "@/sync/local-replica";
import { useSyncHealth } from "@/sync/sync-health";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { showToast } from "@/lib/toast";
import { HardDrive, RefreshCw, Wrench } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

/**
 * Local replica health for the local-first (desktop / offline-core) path.
 * The notes tree renders from local SQLite, so a gap here is exactly what a
 * "my note is missing from Favorites/Recent" report looks like.
 */
export function LocalReplicaPanel() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const sync = useSyncHealth();
  const [repairing, setRepairing] = useState(false);

  const { data, isFetching, refetch } = useQuery({
    queryKey: ["local-replica-diagnostics", user?.id],
    enabled: !!user && OFFLINE_CORE,
    queryFn: () => getReplicaDiagnostics(user!.id),
    staleTime: 15_000,
  });

  if (!OFFLINE_CORE) return null;

  const gap = data ? data.serverTotal - data.localTotal : 0;
  const favGap = data ? data.serverFavorites - data.localFavorites : 0;
  const healthy = data ? gap === 0 && favGap === 0 && data.missingIds.length === 0 : true;

  const handleRepair = async () => {
    if (!user) return;
    setRepairing(true);
    try {
      const count = await repairLocalReplica(user.id);
      await refetch();
      qc.invalidateQueries({ queryKey: ["notes"] });
      showToast.success(`Local copy repaired (${count} notes refreshed)`);
    } catch (error) {
      showToast.error(
        error instanceof Error ? error.message : "Could not repair the local copy",
      );
    } finally {
      setRepairing(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <HardDrive className="h-4 w-4" />
          Local copy
        </CardTitle>
        <CardDescription>
          This device reads your notes from a local database that syncs in the background.
          If a note is missing from the tree, check here first.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Stat label="Notes on device" value={data ? `${data.localTotal}` : "—"} />
          <Stat label="Notes on server" value={data ? `${data.serverTotal}` : "—"} />
          <Stat label="Favorites on device" value={data ? `${data.localFavorites}` : "—"} />
          <Stat label="Favorites on server" value={data ? `${data.serverFavorites}` : "—"} />
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant={data?.connected ? "secondary" : "outline"}>
            {data?.connected ? "Connected" : "Not connected"}
          </Badge>
          <span>
            Last sync:{" "}
            {data?.lastSyncedAt
              ? formatDistanceToNow(new Date(data.lastSyncedAt), { addSuffix: true })
              : "unknown"}
          </span>
          <span>Pending uploads: {data?.pendingUploads ?? 0}</span>
          <Badge variant={healthy ? "secondary" : "destructive"}>
            {healthy ? "In sync" : "Gap detected"}
          </Badge>
        </div>

        {sync.state === "unreachable" && (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs">
            <p className="font-medium mb-1">Background sync is not running.</p>
            <p className="text-muted-foreground">
              {sync.error} Your notes are being read from the server directly, so this
              screen is current, but the local copy below will not update on its own.
            </p>
          </div>
        )}

        {data && data.missingIds.length > 0 && (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs">
            <p className="font-medium mb-1">
              {data.missingIds.length} note{data.missingIds.length === 1 ? "" : "s"} present on the
              server but missing on this device:
            </p>
            <ul className="space-y-0.5 font-mono text-[11px] text-muted-foreground">
              {data.missingIds.map((id) => (
                <li key={id}>{id}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${isFetching ? "animate-spin" : ""}`} />
            Re-check
          </Button>
          <Button size="sm" onClick={handleRepair} disabled={repairing}>
            <Wrench className="h-3.5 w-3.5 mr-1.5" />
            {repairing ? "Repairing…" : "Repair local copy"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-center p-2 rounded-md bg-muted/50">
      <div className="text-lg font-semibold">{value}</div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}
