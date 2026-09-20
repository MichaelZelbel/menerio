import { useCallback, useEffect, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { FolderSync, Laptop, Loader2 } from "lucide-react";
import { BRAND } from "@/lib/brand";
import { disconnectHub } from "@/lib/hub-connect";

/**
 * The hubs connected to this account: since when, which computers have been in
 * touch, what each assistant on them last reported, and the way to end it.
 *
 * Read straight from the two tables (the owner may select their own rows).
 * Ending a connection goes through the hub-connect function, because it has to
 * switch off the hub's keys in the same step.
 */

interface ClientReport {
  state?: string;
  at?: string;
}

interface HubDevice {
  device_id: string;
  name: string;
  last_contact_at: string;
  clients: Record<string, ClientReport> | null;
}

interface HubConnection {
  id: string;
  hub_name: string;
  approved_at: string;
  hub_devices: HubDevice[];
}

/** What an assistant reported, in words. Anything unknown is shown as it came. */
const STATE_LABELS: Record<string, string> = {
  received: "Key received",
  configured: "Set up",
  working: "Working",
  waiting: "Waiting for restart",
  failed: "Failed",
};

const ago = (iso: string) => formatDistanceToNow(new Date(iso), { addSuffix: true });

function stateVariant(state?: string): "default" | "secondary" | "destructive" | "outline" {
  if (state === "working") return "default";
  if (state === "failed") return "destructive";
  return "secondary";
}

export function ConnectedHubsCard() {
  const { toast } = useToast();
  const [hubs, setHubs] = useState<HubConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [ending, setEnding] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    // hub_connections and hub_devices are newer than the generated types.
    const { data, error } = await supabase
      .from("hub_connections" as never)
      .select("id, hub_name, approved_at, hub_devices(device_id, name, last_contact_at, clients)")
      .eq("status", "active")
      .order("approved_at", { ascending: false });
    setFailed(!!error);
    setHubs(error ? [] : ((data ?? []) as unknown as HubConnection[]));
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleDisconnect = async (hub: HubConnection) => {
    setEnding(hub.id);
    const res = await disconnectHub(hub.id);
    setEnding(null);
    if (!res.ok) {
      toast({ variant: "destructive", title: "Could not disconnect", description: res.message });
      return;
    }
    toast({ title: "Hub disconnected", description: `${hub.hub_name} no longer has access.` });
    load();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FolderSync className="h-5 w-5" /> Connected hubs
        </CardTitle>
        <CardDescription>
          A hub is the folder on your computer that your AI assistants work from.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : failed ? (
          <p className="text-sm text-destructive py-2">Could not load your connected hubs. Reload the page to try again.</p>
        ) : hubs.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2">
            No hub is connected. The connection starts from the hub, because a web page cannot
            reach a folder on your computer: tell your hub assistant "connect {BRAND.name}".
          </p>
        ) : (
          <div className="space-y-3">
            {hubs.map((hub) => (
              <div key={hub.id} className="rounded-lg border p-3 space-y-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="font-medium text-sm truncate">{hub.hub_name}</p>
                    <p className="text-xs text-muted-foreground">Connected {ago(hub.approved_at)}</p>
                  </div>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" disabled={ending === hub.id}>
                        {ending === hub.id && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Disconnect
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Disconnect {hub.hub_name}</AlertDialogTitle>
                        <AlertDialogDescription>
                          Disconnect {BRAND.name} from this hub? Every assistant of this hub loses access on its next request. Your original hub files and your own {BRAND.name} notes will stay.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => handleDisconnect(hub)}
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                          Disconnect
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>

                {hub.hub_devices.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No computer of this hub has been in touch yet.</p>
                ) : (
                  <ul className="space-y-2">
                    {[...hub.hub_devices]
                      .sort((a, b) => b.last_contact_at.localeCompare(a.last_contact_at))
                      .map((device) => (
                        <li key={device.device_id} className="flex items-start gap-2 text-sm">
                          <Laptop className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                          <div className="min-w-0 space-y-1">
                            <p>
                              <span className="font-medium">{device.name}</span>
                              <span className="text-xs text-muted-foreground"> · last contact {ago(device.last_contact_at)}</span>
                            </p>
                            <div className="flex flex-wrap gap-1">
                              {Object.entries(device.clients ?? {}).map(([client, report]) => (
                                <Badge
                                  key={client}
                                  variant={stateVariant(report?.state)}
                                  className="text-[10px]"
                                  title={report?.at ? `Reported ${ago(report.at)}` : undefined}
                                >
                                  {client}: {STATE_LABELS[report?.state ?? ""] ?? report?.state ?? "unknown"}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        </li>
                      ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
