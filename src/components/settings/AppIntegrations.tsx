import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { showToast } from "@/lib/toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Copy, Check, Trash2, Plug, ExternalLink, Loader2, ChevronDown, Plus } from "lucide-react";

/* ────────────────────────────── Known Apps Registry ────────────────────────────── */

interface KnownApp {
  id: string;
  name: string;
  description: string;
  /** Base URL of the app's Supabase project */
  supabaseUrl: string;
  /** Path appended to supabaseUrl to form the webhook */
  webhookPath: string;
  icon: string;
}

const KNOWN_APPS: KnownApp[] = [
  {
    id: "querino",
    name: "Querino",
    description: "AI research assistant — syncs artefacts as notes to Menerio.",
    supabaseUrl: "https://bqsovmbjnkftsjfwdlia.supabase.co",
    webhookPath: "/functions/v1/menerio-webhook",
    icon: "🔬",
  },
  {
    id: "temerio",
    name: "Temerio",
    description: "Task & project management — syncs tasks and milestones.",
    supabaseUrl: "https://temerio.supabase.co",
    webhookPath: "/functions/v1/menerio-webhook",
    icon: "📋",
  },
  {
    id: "cherishly",
    name: "Cherishly",
    description: "Relationship tracker — syncs memories and moments.",
    supabaseUrl: "https://cherishly.supabase.co",
    webhookPath: "/functions/v1/menerio-webhook",
    icon: "💝",
  },
];

/* ────────────────────────────── Types ────────────────────────────── */

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

/* ────────────────────────────── Component ────────────────────────────── */

export function AppIntegrations() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const [newApiKey, setNewApiKey] = useState<string | null>(null);
  const [connectingAppId, setConnectingAppId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Advanced custom connection state
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [customDialogOpen, setCustomDialogOpen] = useState(false);
  const [customAppName, setCustomAppName] = useState("");
  const [customDisplayName, setCustomDisplayName] = useState("");
  const [customWebhookUrl, setCustomWebhookUrl] = useState("");

  const hasPending = apps.some((a) => a.connection_status === "pending");

  const { data: apps = [], isLoading } = useQuery<ConnectedApp[]>({
    queryKey: ["connected_apps", user?.id],
    enabled: !!user,
    refetchInterval: hasPending ? 5000 : false,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("connected_apps" as any)
        .select("*")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data as unknown as ConnectedApp[]) || [];
    },
  });

  /* ── Connect a known app ── */
  const connectKnownApp = useMutation({
    mutationFn: async (known: KnownApp) => {
      const apiKey = generateApiKey();
      const webhookUrl = `${known.supabaseUrl}${known.webhookPath}`;
      const { error } = await supabase
        .from("connected_apps" as any)
        .insert({
          user_id: user!.id,
          app_name: known.id,
          display_name: known.name,
          webhook_url: webhookUrl,
          api_key: apiKey,
        });
      if (error) throw error;
      return apiKey;
    },
    onSuccess: (apiKey) => {
      setNewApiKey(apiKey);
      qc.invalidateQueries({ queryKey: ["connected_apps"] });
      showToast.success("App connected!");
    },
    onError: (err: any) => {
      setConnectingAppId(null);
      showToast.error(err.message || "Failed to connect app");
    },
  });

  /* ── Connect a custom app (advanced) ── */
  const connectCustomApp = useMutation({
    mutationFn: async () => {
      const apiKey = generateApiKey();
      const { error } = await supabase
        .from("connected_apps" as any)
        .insert({
          user_id: user!.id,
          app_name: customAppName.toLowerCase().trim(),
          display_name: customDisplayName.trim(),
          webhook_url: customWebhookUrl.trim() || null,
          api_key: apiKey,
        });
      if (error) throw error;
      return apiKey;
    },
    onSuccess: (apiKey) => {
      setNewApiKey(apiKey);
      setConnectingAppId("custom");
      qc.invalidateQueries({ queryKey: ["connected_apps"] });
      showToast.success("App connected!");
    },
    onError: (err: any) => {
      showToast.error(err.message || "Failed to create connection");
    },
  });

  const toggleActive = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase
        .from("connected_apps" as any)
        .update({ is_active })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["connected_apps"] });
    },
  });

  const deleteApp = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("connected_apps" as any)
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["connected_apps"] });
      showToast.success("Connection removed");
    },
  });

  const handleConnectKnown = (known: KnownApp) => {
    setConnectingAppId(known.id);
    connectKnownApp.mutate(known);
  };

  const handleCopy = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCloseApiKeyDialog = () => {
    setNewApiKey(null);
    setConnectingAppId(null);
    setCustomDialogOpen(false);
    setCustomAppName("");
    setCustomDisplayName("");
    setCustomWebhookUrl("");
    setCopied(false);
  };

  const handleCreateCustom = () => {
    if (!customAppName.trim() || !customDisplayName.trim()) return;
    connectCustomApp.mutate();
  };

  const connectedAppNames = new Set(apps.map((a) => a.app_name));

  return (
    <div className="space-y-6">
      {/* ── App Catalog ── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Plug className="h-5 w-5" /> App Integrations
          </CardTitle>
          <CardDescription>
            Connect external apps to sync data with Menerio. Click "Connect" and paste the generated key in the other app.
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
                  <div
                    key={known.id}
                    className="flex items-center justify-between rounded-lg border p-4"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-2xl">{known.icon}</span>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-foreground">{known.name}</span>
                          {existing && (
                            <Badge variant={existing.is_active ? "default" : "secondary"} className="text-[10px] px-1.5">
                              {existing.is_active ? "Connected" : "Paused"}
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">{known.description}</p>
                      </div>
                    </div>

                    {existing ? (
                      <div className="flex items-center gap-3">
                        <Switch
                          checked={existing.is_active}
                          onCheckedChange={(checked) =>
                            toggleActive.mutate({ id: existing.id, is_active: checked })
                          }
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
                        onClick={() => handleConnectKnown(known)}
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

              {/* Show any custom-connected apps that aren't in KNOWN_APPS */}
              {apps
                .filter((a) => !KNOWN_APPS.some((k) => k.id === a.app_name))
                .map((app) => (
                  <div
                    key={app.id}
                    className="flex items-center justify-between rounded-lg border p-4"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-2xl">🔌</span>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-foreground">{app.display_name}</span>
                          <Badge variant={app.is_active ? "default" : "secondary"} className="text-[10px] px-1.5">
                            {app.is_active ? "Connected" : "Paused"}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground font-mono">{app.app_name}</p>
                        {app.webhook_url && (
                          <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                            <ExternalLink className="h-3 w-3" />
                            {app.webhook_url}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <Switch
                        checked={app.is_active}
                        onCheckedChange={(checked) =>
                          toggleActive.mutate({ id: app.id, is_active: checked })
                        }
                      />
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Remove {app.display_name}?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This will revoke the API key. The app will no longer be able to sync.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => deleteApp.mutate(app.id)}
                              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            >
                              Remove
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </div>
                ))}
            </div>
          )}

          {/* ── Advanced: Custom App ── */}
          <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen} className="mt-6">
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground">
                <ChevronDown className={`h-4 w-4 transition-transform ${advancedOpen ? "rotate-180" : ""}`} />
                Advanced: Connect a custom app
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-3">
              <p className="text-xs text-muted-foreground mb-3">
                For developers building custom integrations. You'll need to provide the app details manually.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => setCustomDialogOpen(true)}
              >
                <Plus className="h-4 w-4" /> Add Custom Connection
              </Button>
            </CollapsibleContent>
          </Collapsible>
        </CardContent>
      </Card>

      {/* ── API Key Reveal Dialog (shown after connecting any app) ── */}
      <Dialog open={!!newApiKey} onOpenChange={(open) => { if (!open) handleCloseApiKeyDialog(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Connection Key Generated</DialogTitle>
            <DialogDescription>
              Copy this key and paste it into the other app's Menerio settings. You won't see it again.
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
            <p className="text-xs text-muted-foreground">
              Paste this key in the other app's settings under "Menerio Connection" or similar.
            </p>
          </div>
          <DialogFooter>
            <Button onClick={handleCloseApiKeyDialog}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Custom App Dialog ── */}
      <Dialog open={customDialogOpen && !newApiKey} onOpenChange={(open) => { if (!open) handleCloseApiKeyDialog(); else setCustomDialogOpen(true); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Connect a Custom App</DialogTitle>
            <DialogDescription>
              For developers: add a custom app that can interact with your Menerio data.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="customAppName">App Identifier</Label>
              <Input
                id="customAppName"
                value={customAppName}
                onChange={(e) => setCustomAppName(e.target.value)}
                placeholder="my-app"
              />
              <p className="text-xs text-muted-foreground">Lowercase identifier, e.g. "my-crm"</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="customDisplayName">Display Name</Label>
              <Input
                id="customDisplayName"
                value={customDisplayName}
                onChange={(e) => setCustomDisplayName(e.target.value)}
                placeholder="My CRM"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="customWebhookUrl">
                Webhook URL <span className="text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="customWebhookUrl"
                type="url"
                value={customWebhookUrl}
                onChange={(e) => setCustomWebhookUrl(e.target.value)}
                placeholder="https://your-app.supabase.co/functions/v1/webhook"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              onClick={handleCreateCustom}
              disabled={!customAppName.trim() || !customDisplayName.trim() || connectCustomApp.isPending}
            >
              {connectCustomApp.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create & Generate Key
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
