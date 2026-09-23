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
import { disconnectGodspeed } from "@/lib/mc-connect";

/**
 * Mission Controls connected to this account: since when, which computers have been in
 * touch, what each assistant on them last reported, and the way to end it.
 *
 * Read straight from the two tables (the owner may select their own rows).
 * Ending a connection goes through the mc-connect function, because it has to
 * switch off Mission Control's keys in the same step.
 */

interface ClientReport {
  state?: string;
  at?: string;
}

interface GodspeedDevice {
  device_id: string;
  name: string;
  last_contact_at: string;
  clients: Record<string, ClientReport> | null;
}

interface GodspeedConnection {
  id: string;
  godspeed_name: string;
  approved_at: string;
  godspeed_devices: GodspeedDevice[];
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

export function ConnectedGodspeedsCard() {
  const { toast } = useToast();
  const [godspeed, setGodspeeds] = useState<GodspeedConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [ending, setEnding] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    // godspeed_connections and godspeed_devices are newer than the generated types.
    const { data, error } = await supabase
      .from("godspeed_connections" as never)
      .select("id, godspeed_name, approved_at, godspeed_devices(device_id, name, last_contact_at, clients)")
      .eq("status", "active")
      .order("approved_at", { ascending: false });
    setFailed(!!error);
    setGodspeeds(error ? [] : ((data ?? []) as unknown as GodspeedConnection[]));
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleDisconnect = async (godspeed: GodspeedConnection) => {
    setEnding(godspeed.id);
    const res = await disconnectGodspeed(godspeed.id);
    setEnding(null);
    if (!res.ok) {
      toast({ variant: "destructive", title: "Could not disconnect", description: res.message });
      return;
    }
    toast({ title: "Mission Control disconnected", description: `${godspeed.godspeed_name} no longer has access.` });
    load();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FolderSync className="h-5 w-5" /> Connected mission controls
        </CardTitle>
        <CardDescription>
          A mission control is the folder on your computer that your AI assistants work from.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : failed ? (
          <p className="text-sm text-destructive py-2">Could not load your connected mission controls. Reload the page to try again.</p>
        ) : godspeed.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2">
            No mission control is connected. The connection starts from Mission Control, because a web page cannot
            reach a folder on your computer: tell your mission control assistant "connect {BRAND.name}".
          </p>
        ) : (
          <div className="space-y-3">
            {godspeed.map((godspeed) => (
              <div key={godspeed.id} className="rounded-lg border p-3 space-y-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="font-medium text-sm truncate">{godspeed.godspeed_name}</p>
                    <p className="text-xs text-muted-foreground">Connected {ago(godspeed.approved_at)}</p>
                  </div>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" disabled={ending === godspeed.id}>
                        {ending === godspeed.id && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Disconnect
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Disconnect {godspeed.godspeed_name}</AlertDialogTitle>
                        <AlertDialogDescription>
                          Disconnect {BRAND.name} from this mission control? Every assistant of this mission control loses access on its next request. Your original mission control files and your own {BRAND.name} notes will stay.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => handleDisconnect(godspeed)}
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                          Disconnect
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>

                {godspeed.godspeed_devices.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No computer of this mission control has been in touch yet.</p>
                ) : (
                  <ul className="space-y-2">
                    {[...godspeed.godspeed_devices]
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
