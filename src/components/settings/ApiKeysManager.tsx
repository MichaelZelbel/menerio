import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
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
import { Loader2, Plus, Copy, Check, Key, Trash2, AlertTriangle } from "lucide-react";

const ALL_SCOPES = [
  { value: "profile", label: "Profile", desc: "Profile categories, entries, agent instructions" },
  { value: "notes", label: "Notes", desc: "Read/write notes" },
  { value: "contacts", label: "Contacts", desc: "Contacts and interactions" },
  { value: "actions", label: "Actions", desc: "Action items" },
  { value: "graph", label: "Graph", desc: "Connections and graph data" },
  { value: "media", label: "Media", desc: "Media analysis results" },
  { value: "stats", label: "Stats", desc: "Read-only statistics" },
];

interface ApiKey {
  id: string;
  name: string;
  key_prefix: string;
  scopes: string[];
  last_used_at: string | null;
  is_active: boolean;
  created_at: string;
  expires_at: string | null;
}

export function ApiKeysManager() {
  const { toast } = useToast();
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [newKeyScopes, setNewKeyScopes] = useState<string[]>(["profile"]);
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const fetchKeys = async () => {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await supabase.functions.invoke("hub-api-keys", {
        method: "GET",
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      if (res.data?.keys) {
        setKeys(res.data.keys);
      }
    } catch {
      toast({ variant: "destructive", title: "Error", description: "Failed to load API keys." });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchKeys();
  }, []);

  const handleGenerate = async () => {
    if (!newKeyName.trim() || newKeyScopes.length === 0) return;
    setGenerating(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await supabase.functions.invoke("hub-api-keys/generate", {
        method: "POST",
        headers: { Authorization: `Bearer ${session?.access_token}` },
        body: { name: newKeyName.trim(), scopes: newKeyScopes },
      });
      if (res.error || res.data?.error) {
        toast({ variant: "destructive", title: "Error", description: res.data?.error || "Failed to generate key." });
        return;
      }
      setGeneratedKey(res.data.api_key);
      toast({ title: "API key generated", description: "Copy it now — you won't see it again." });
      fetchKeys();
    } catch {
      toast({ variant: "destructive", title: "Error", description: "Something went wrong." });
    } finally {
      setGenerating(false);
    }
  };

  const handleRevoke = async (id: string) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      await supabase.functions.invoke(`hub-api-keys/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      toast({ title: "Key revoked" });
      fetchKeys();
    } catch {
      toast({ variant: "destructive", title: "Error", description: "Failed to revoke key." });
    }
  };

  const handleCopy = async () => {
    if (!generatedKey) return;
    await navigator.clipboard.writeText(generatedKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const toggleScope = (scope: string) => {
    setNewKeyScopes((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope]
    );
  };

  const resetDialog = () => {
    setNewKeyName("");
    setNewKeyScopes(["profile"]);
    setGeneratedKey(null);
    setCopied(false);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Key className="h-5 w-5" /> API Keys
        </CardTitle>
        <CardDescription>
          API keys let external apps (like the Profile app) sync with your Menerio data. Each key is scoped to specific data types.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Dialog
          open={generateOpen}
          onOpenChange={(open) => {
            setGenerateOpen(open);
            if (!open) resetDialog();
          }}
        >
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="mr-2 h-4 w-4" /> Generate new API key
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Generate API Key</DialogTitle>
              <DialogDescription>
                Create a new key for an external app. Choose which data it can access.
              </DialogDescription>
            </DialogHeader>

            {generatedKey ? (
              <div className="space-y-4">
                <div className="rounded-lg border border-warning/50 bg-warning/10 p-4 space-y-2">
                  <div className="flex items-center gap-2 text-warning">
                    <AlertTriangle className="h-4 w-4" />
                    <span className="text-sm font-medium">Copy this key now — you won't be able to see it again</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 text-xs bg-muted p-2 rounded font-mono break-all">
                      {generatedKey}
                    </code>
                    <Button size="sm" variant="outline" onClick={handleCopy}>
                      {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>
                <DialogFooter>
                  <Button onClick={() => { setGenerateOpen(false); resetDialog(); }}>
                    Done
                  </Button>
                </DialogFooter>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="keyName">Name</Label>
                  <Input
                    id="keyName"
                    value={newKeyName}
                    onChange={(e) => setNewKeyName(e.target.value)}
                    placeholder='e.g., "Profile App", "Querino"'
                  />
                </div>
                <div className="space-y-2">
                  <Label>Scopes</Label>
                  <div className="grid grid-cols-2 gap-2">
                    {ALL_SCOPES.map((scope) => (
                      <label
                        key={scope.value}
                        className="flex items-start gap-2 rounded-md border p-2 cursor-pointer hover:bg-muted/50"
                      >
                        <Checkbox
                          checked={newKeyScopes.includes(scope.value)}
                          onCheckedChange={() => toggleScope(scope.value)}
                          className="mt-0.5"
                        />
                        <div>
                          <span className="text-sm font-medium">{scope.label}</span>
                          <p className="text-xs text-muted-foreground">{scope.desc}</p>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
                <DialogFooter>
                  <Button
                    onClick={handleGenerate}
                    disabled={generating || !newKeyName.trim() || newKeyScopes.length === 0}
                  >
                    {generating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Generate
                  </Button>
                </DialogFooter>
              </div>
            )}
          </DialogContent>
        </Dialog>

        <Separator />

        {loading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : keys.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            No API keys yet. Generate one to connect an external app.
          </p>
        ) : (
          <div className="space-y-3">
            {keys.map((key) => (
              <div
                key={key.id}
                className={`flex items-start justify-between gap-4 rounded-lg border p-3 ${
                  !key.is_active ? "opacity-50" : ""
                }`}
              >
                <div className="space-y-1 min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm">{key.name}</span>
                    <code className="text-xs text-muted-foreground font-mono">
                      {key.key_prefix}...
                    </code>
                    {!key.is_active && (
                      <Badge variant="destructive" className="text-[10px]">Revoked</Badge>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {key.scopes.map((scope) => (
                      <Badge key={scope} variant="secondary" className="text-[10px]">
                        {scope}
                      </Badge>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {key.last_used_at
                      ? `Last used ${new Date(key.last_used_at).toLocaleDateString()}`
                      : "Never used"}
                    {" · "}
                    Created {new Date(key.created_at).toLocaleDateString()}
                  </p>
                </div>
                {key.is_active && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Revoke API Key</AlertDialogTitle>
                        <AlertDialogDescription>
                          This will permanently deactivate the key "{key.name}". Any app using this key will lose access immediately.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => handleRevoke(key.id)}
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                          Revoke
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
