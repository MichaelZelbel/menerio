import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
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
import { Plus, Loader2, Trash2, Server } from "lucide-react";
import { toast } from "sonner";
import { BRAND } from "@/lib/brand";

/**
 * Connected AI tools (outbound MCP servers). Lets the user register third-party
 * Model Context Protocol servers that Menerio's chat agents (note-chat + Mira)
 * may call as tools. This is the outbound counterpart to the "MCP" tab, which
 * lets external clients into Menerio's own server.
 */

type McpServer = {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  created_at: string;
};

export function UserMcpServersManager() {
  const [servers, setServers] = useState<McpServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  // Add-form state
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");

  async function load() {
    setLoading(true);
    const { data, error } = await (supabase as any)
      .from("user_mcp_servers")
      .select("id, name, url, enabled, created_at")
      .order("created_at", { ascending: true });
    if (error) {
      toast.error("Could not load MCP servers", { description: error.message });
    } else {
      setServers((data || []) as McpServer[]);
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function addServer() {
    if (!name.trim() || !url.trim()) {
      toast.error("Name and URL are required");
      return;
    }
    if (!/^https:\/\//i.test(url.trim())) {
      toast.error("URL must start with https://");
      return;
    }
    setSaving(true);
    const auth = token.trim() ? { token: token.trim() } : {};
    const { error } = await (supabase as any).from("user_mcp_servers").insert({
      name: name.trim(),
      url: url.trim(),
      auth,
    });
    setSaving(false);
    if (error) {
      toast.error("Could not add server", { description: error.message });
      return;
    }
    toast.success("MCP server added");
    setName("");
    setUrl("");
    setToken("");
    setAddOpen(false);
    load();
  }

  async function toggleEnabled(server: McpServer, enabled: boolean) {
    // Optimistic update.
    setServers((prev) => prev.map((s) => (s.id === server.id ? { ...s, enabled } : s)));
    const { error } = await (supabase as any)
      .from("user_mcp_servers")
      .update({ enabled })
      .eq("id", server.id);
    if (error) {
      toast.error("Could not update server", { description: error.message });
      load();
    }
  }

  async function removeServer(id: string) {
    const { error } = await (supabase as any).from("user_mcp_servers").delete().eq("id", id);
    if (error) {
      toast.error("Could not delete server", { description: error.message });
      return;
    }
    toast.success("Server removed");
    load();
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Server className="h-5 w-5" /> Connected AI tools (MCP)
            </CardTitle>
            <CardDescription>
              Give {BRAND.name}'s AI chat extra tools by connecting your own Model
              Context Protocol (MCP) servers. When enabled, the in-note chat and
              {BRAND.personaName} can call these servers' tools while helping you. Only add
              servers you trust — their tools run on your behalf.
            </CardDescription>
          </div>
          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="h-4 w-4 mr-1" /> Add server
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add an MCP server</DialogTitle>
                <DialogDescription>
                  Connect a third-party MCP server over HTTPS. The token (if any)
                  is stored privately and only used server-side to authenticate.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <div className="space-y-1.5">
                  <Label htmlFor="mcp-name">Name</Label>
                  <Input
                    id="mcp-name"
                    placeholder="e.g. My Linear"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="mcp-url">Server URL (Streamable HTTP)</Label>
                  <Input
                    id="mcp-url"
                    placeholder="https://example.com/mcp"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="mcp-token">Bearer token (optional)</Label>
                  <Input
                    id="mcp-token"
                    type="password"
                    placeholder="Only if the server requires auth"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setAddOpen(false)} disabled={saving}>
                  Cancel
                </Button>
                <Button onClick={addServer} disabled={saving}>
                  {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
                  Add server
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : servers.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No MCP servers connected yet. Add one to give the AI chat extra tools.
          </p>
        ) : (
          servers.map((server) => (
            <div
              key={server.id}
              className="flex items-center justify-between gap-4 rounded-md border p-3"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium truncate">{server.name}</span>
                  {!server.enabled && <Badge variant="outline">disabled</Badge>}
                </div>
                <p className="text-xs text-muted-foreground truncate">{server.url}</p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <Switch
                  checked={server.enabled}
                  onCheckedChange={(v) => toggleEnabled(server, v)}
                  aria-label="Enable server"
                />
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="ghost" size="icon" aria-label="Delete server">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Remove this MCP server?</AlertDialogTitle>
                      <AlertDialogDescription>
                        "{server.name}" will no longer be available to the AI chat.
                        This cannot be undone.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={() => removeServer(server.id)}>
                        Remove
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
