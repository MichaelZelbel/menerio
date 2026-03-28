import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { showToast } from "@/lib/toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import { Plus, Copy, Check, Trash2, Plug, ExternalLink, Loader2 } from "lucide-react";

interface ConnectedApp {
  id: string;
  user_id: string;
  app_name: string;
  display_name: string;
  api_key: string;
  webhook_url: string | null;
  is_active: boolean;
  permissions: { can_push_notes: boolean; can_receive_patches: boolean };
  created_at: string;
  updated_at: string;
}

function generateApiKey(): string {
  return (crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, ""));
}

export function ConnectionsManager() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [appName, setAppName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [newApiKey, setNewApiKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const { data: apps = [], isLoading } = useQuery<ConnectedApp[]>({
    queryKey: ["connected_apps", user?.id],
    enabled: !!user,
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

  const createApp = useMutation({
    mutationFn: async () => {
      const apiKey = generateApiKey();
      const { error } = await supabase
        .from("connected_apps" as any)
        .insert({
          user_id: user!.id,
          app_name: appName.toLowerCase().trim(),
          display_name: displayName.trim(),
          webhook_url: webhookUrl.trim() || null,
          api_key: apiKey,
        });
      if (error) throw error;
      return apiKey;
    },
    onSuccess: (apiKey) => {
      setNewApiKey(apiKey);
      qc.invalidateQueries({ queryKey: ["connected_apps"] });
      showToast.success("App connected successfully");
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

  const handleCreate = () => {
    if (!appName.trim() || !displayName.trim()) return;
    createApp.mutate();
  };

  const handleCloseDialog = () => {
    setDialogOpen(false);
    setAppName("");
    setDisplayName("");
    setWebhookUrl("");
    setNewApiKey(null);
    setCopied(false);
  };

  const handleCopy = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Plug className="h-5 w-5" /> Connected Apps
            </CardTitle>
            <CardDescription className="mt-1">
              Manage external apps that can push notes to Menerio or receive patch requests.
            </CardDescription>
          </div>
          <Dialog open={dialogOpen} onOpenChange={(open) => { if (!open) handleCloseDialog(); else setDialogOpen(true); }}>
            <DialogTrigger asChild>
              <Button size="sm" className="gap-1.5">
                <Plus className="h-4 w-4" /> New Connection
              </Button>
            </DialogTrigger>
            <DialogContent>
              {newApiKey ? (
                <>
                  <DialogHeader>
                    <DialogTitle>API Key Generated</DialogTitle>
                    <DialogDescription>
                      Copy this API key now — it will not be shown again.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <code className="flex-1 rounded bg-muted px-3 py-2 text-xs font-mono break-all select-all">
                        {newApiKey}
                      </code>
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => handleCopy(newApiKey)}
                      >
                        {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      The external app must send this key in the <code className="text-xs">x-api-key</code> header when calling Menerio's API.
                    </p>
                  </div>
                  <DialogFooter>
                    <Button onClick={handleCloseDialog}>Done</Button>
                  </DialogFooter>
                </>
              ) : (
                <>
                  <DialogHeader>
                    <DialogTitle>Connect a New App</DialogTitle>
                    <DialogDescription>
                      Add an external app that can interact with your Menerio notes.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="appName">App Name</Label>
                      <Input
                        id="appName"
                        value={appName}
                        onChange={(e) => setAppName(e.target.value)}
                        placeholder="cherishly"
                      />
                      <p className="text-xs text-muted-foreground">Lowercase identifier, e.g. "cherishly", "temerio"</p>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="displayName">Display Name</Label>
                      <Input
                        id="displayName"
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        placeholder="Cherishly"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="webhookUrl">Webhook URL <span className="text-muted-foreground">(optional)</span></Label>
                      <Input
                        id="webhookUrl"
                        type="url"
                        value={webhookUrl}
                        onChange={(e) => setWebhookUrl(e.target.value)}
                        placeholder="https://your-app.supabase.co/functions/v1/webhook"
                      />
                      <p className="text-xs text-muted-foreground">URL that Menerio calls for patch requests</p>
                    </div>
                  </div>
                  <DialogFooter>
                    <Button
                      onClick={handleCreate}
                      disabled={!appName.trim() || !displayName.trim() || createApp.isPending}
                    >
                      {createApp.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      Create & Generate API Key
                    </Button>
                  </DialogFooter>
                </>
              )}
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : apps.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Plug className="h-10 w-10 mx-auto mb-3 opacity-40" />
            <p className="text-sm">No connected apps yet.</p>
            <p className="text-xs mt-1">Connect an external app to start syncing notes.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {apps.map((app) => (
              <div
                key={app.id}
                className="flex items-center justify-between rounded-lg border p-4"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-foreground">{app.display_name}</span>
                    <Badge variant={app.is_active ? "default" : "secondary"} className="text-[10px] px-1.5">
                      {app.is_active ? "Active" : "Inactive"}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground font-mono">{app.app_name}</p>
                  {app.webhook_url && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <ExternalLink className="h-3 w-3" />
                      {app.webhook_url}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <Switch
                    checked={app.is_active}
                    onCheckedChange={(checked) => toggleActive.mutate({ id: app.id, is_active: checked })}
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
                          This will revoke the API key. The app will no longer be able to push notes or receive patches.
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
      </CardContent>
    </Card>
  );
}
