import { useState } from "react";
import querinoLogo from "@/assets/querino-logo.png";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { showToast } from "@/lib/toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Copy, Check, Trash2, Plug, Loader2 } from "lucide-react";

interface KnownApp {
  id: string;
  name: string;
  description: string;
  supabaseUrl: string;
  webhookPath: string;
  icon: string;
  iconImage?: string;
}

const KNOWN_APPS: KnownApp[] = [
  {
    id: "querino",
    name: "Querino",
    description: "AI research assistant — syncs artefacts as notes to Menerio.",
    supabaseUrl: "https://bqsovmbjnkftsjfwdlia.supabase.co",
    webhookPath: "/functions/v1/menerio-webhook",
    icon: "🔬",
    iconImage: querinoLogo,
  },
];

interface ConnectedApp {
  id: string;
  user_id: string;
  app_name: string;
  display_name: string;
  api_key: string;
  webhook_url: string | null;
  is_active: boolean;
  connection_status: "pending" | "active" | "revoked";
  permissions: { can_push_notes: boolean; can_receive_patches: boolean };
  created_at: string;
  updated_at: string;
}

function generateApiKey(): string {
  return crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
}

async function sha256Hex(value: string): Promise<string> {
  const hashBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function AppIntegrations() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [newApiKey, setNewApiKey] = useState<string | null>(null);
  const [connectingAppId, setConnectingAppId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const { data: apps = [], isLoading } = useQuery<ConnectedApp[]>({
    queryKey: ["connected_apps", user?.id],
    enabled: !!user,
    refetchInterval: (query) => {
      const data = query.state.data;
      return data?.some((a) => a.connection_status === "pending") ? 5000 : false;
    },
    queryFn: async () => {
      const { data, error } = await supabase
        .from("connected_apps" as any)
        .select("*")
        .eq("user_id", user!.id)
        .in("app_name", KNOWN_APPS.map((app) => app.id))
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data as unknown as ConnectedApp[]) || [];
    },
  });

  const connectKnownApp = useMutation({
    mutationFn: async (known: KnownApp) => {
      const apiKey = generateApiKey();
      const keyPrefix = apiKey.slice(0, 12);
      const webhookUrl = `${known.supabaseUrl}${known.webhookPath}`;
      const { error } = await supabase.from("connected_apps" as any).insert({
        user_id: user!.id,
        app_name: known.id,
        display_name: known.name,
        webhook_url: webhookUrl,
        api_key: keyPrefix,
        key_prefix: keyPrefix,
        key_hash: await sha256Hex(apiKey),
      });
      if (error) throw error;
      return apiKey;
    },
    onSuccess: (apiKey) => {
      setNewApiKey(apiKey);
      qc.invalidateQueries({ queryKey: ["connected_apps"] });
      showToast.success("App connected!");
    },
    onError: (err: Error) => {
      setConnectingAppId(null);
      showToast.error(err.message || "Failed to connect app");
    },
  });

  const toggleActive = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase.from("connected_apps" as any).update({ is_active }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["connected_apps"] }),
  });

  const deleteApp = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("connected_apps" as any).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["connected_apps"] });
      showToast.success("Connection removed");
    },
  });

  const handleCopy = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCloseApiKeyDialog = () => {
    setNewApiKey(null);
    setConnectingAppId(null);
    setCopied(false);
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Plug className="h-5 w-5" /> App Integrations
          </CardTitle>
          <CardDescription>
            Connect Querino to sync research artefacts with Menerio.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="space-y-3">
              {KNOWN_APPS.map((known) => {
                const existing = apps.find((a) => a.app_name === known.id);
                return (
                  <div key={known.id} className="flex items-center justify-between rounded-lg border p-4">
                    <div className="flex items-center gap-3">
                      {known.iconImage ? (
                        <img src={known.iconImage} alt={known.name} className="h-7 w-7 rounded" />
                      ) : (
                        <span className="text-2xl">{known.icon}</span>
                      )}
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-foreground">{known.name}</span>
                          {existing && (
                            existing.connection_status === "pending" ? (
                              <Badge variant="warning" className="text-[10px] px-1.5">Awaiting handshake…</Badge>
                            ) : !existing.is_active ? (
                              <Badge variant="secondary" className="text-[10px] px-1.5">Paused</Badge>
                            ) : (
                              <Badge variant="success" className="text-[10px] px-1.5">Connected</Badge>
                            )
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">{known.description}</p>
                        {existing?.connection_status === "pending" && (
                          <p className="text-xs text-warning mt-0.5">Paste the key in {known.name} to complete setup.</p>
                        )}
                      </div>
                    </div>

                    {existing ? (
                      <div className="flex items-center gap-3">
                        <Switch
                          checked={existing.is_active}
                          onCheckedChange={(checked) => toggleActive.mutate({ id: existing.id, is_active: checked })}
                        />
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive">
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Disconnect {known.name}?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This revokes the API key. {known.name} will no longer be able to sync with Menerio.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => deleteApp.mutate(existing.id)}
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              >
                                Disconnect
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    ) : (
                      <Button
                        size="sm"
                        onClick={() => {
                          setConnectingAppId(known.id);
                          connectKnownApp.mutate(known);
                        }}
                        disabled={connectKnownApp.isPending && connectingAppId === known.id}
                      >
                        {connectKnownApp.isPending && connectingAppId === known.id && (
                          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                        )}
                        Connect
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!newApiKey} onOpenChange={(open) => { if (!open) handleCloseApiKeyDialog(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Connection Key Generated</DialogTitle>
            <DialogDescription>
              Copy this key and paste it into Querino's Menerio settings. You won't see it again.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded bg-muted px-3 py-2 text-xs font-mono break-all select-all">
                {newApiKey}
              </code>
              <Button variant="outline" size="icon" onClick={() => newApiKey && handleCopy(newApiKey)}>
                {copied ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">Paste this key in Querino's settings under Menerio Connection.</p>
          </div>
          <DialogFooter>
            <Button onClick={handleCloseApiKeyDialog}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
