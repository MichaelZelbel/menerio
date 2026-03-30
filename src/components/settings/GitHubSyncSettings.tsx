import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useGitHubConnection, useGitHubBulkSync } from "@/hooks/useGitHubSync";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Github, CheckCircle2, XCircle, AlertTriangle, Trash2, RefreshCw } from "lucide-react";
import { showToast } from "@/lib/toast";
import { formatDistanceToNow } from "date-fns";

export function GitHubSyncSettings() {
  const { user } = useAuth();
  const { data: connection, isLoading, refetch } = useGitHubConnection();
  const bulkSync = useGitHubBulkSync();
  const qc = useQueryClient();

  const [token, setToken] = useState("");
  const [repoOwner, setRepoOwner] = useState("");
  const [repoName, setRepoName] = useState("");
  const [branch, setBranch] = useState("main");
  const [vaultPath, setVaultPath] = useState("/");
  const [syncDirection, setSyncDirection] = useState("export");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<"success" | "error" | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);

  useEffect(() => {
    if (connection) {
      setRepoOwner(connection.repo_owner || "");
      setRepoName(connection.repo_name || "");
      setBranch(connection.branch || "main");
      setVaultPath(connection.vault_path || "/");
      setSyncDirection(connection.sync_direction || "export");
    }
  }, [connection]);

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);
    try {
      if (connection) {
        const updates: Record<string, unknown> = {
          repo_owner: repoOwner,
          repo_name: repoName,
          branch,
          vault_path: vaultPath,
          sync_direction: syncDirection,
        };
        if (token) updates.github_token = token;
        await supabase.from("github_connections" as any).update(updates).eq("user_id", user.id);
      } else {
        if (!token) { showToast.error("Token is required"); setSaving(false); return; }
        // Fetch GitHub username
        let username = "";
        try {
          const res = await fetch("https://api.github.com/user", {
            headers: { Authorization: `token ${token}` },
          });
          if (res.ok) {
            const data = await res.json();
            username = data.login;
          }
        } catch { /* ignore */ }

        await supabase.from("github_connections" as any).insert({
          user_id: user.id,
          github_token: token,
          github_username: username,
          repo_owner: repoOwner || username,
          repo_name: repoName,
          branch,
          vault_path: vaultPath,
          sync_direction: syncDirection,
        });
      }
      setToken("");
      await refetch();
      showToast.success("GitHub connection saved");
    } catch (err: any) {
      showToast.error(err.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    const ghToken = token || connection?.github_token;
    const owner = repoOwner || connection?.repo_owner;
    const repo = repoName || connection?.repo_name;
    if (!ghToken || !owner || !repo) {
      showToast.error("Fill in token and repository first");
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
        headers: { Authorization: `token ${ghToken}` },
      });
      if (res.ok) {
        setTestResult("success");
        showToast.success("Connection successful!");
      } else {
        setTestResult("error");
        showToast.error(`Failed: ${res.status} ${res.statusText}`);
      }
    } catch {
      setTestResult("error");
      showToast.error("Connection failed");
    } finally {
      setTesting(false);
    }
  };

  const handleDisconnect = async () => {
    if (!user) return;
    setDisconnecting(true);
    try {
      await supabase.from("github_connections" as any).delete().eq("user_id", user.id);
      await supabase.from("github_sync_log" as any).delete().eq("user_id", user.id);
      await refetch();
      qc.invalidateQueries({ queryKey: ["github-sync-log"] });
      showToast.success("GitHub disconnected");
    } catch {
      showToast.error("Failed to disconnect");
    } finally {
      setDisconnecting(false);
    }
  };

  const handleBulkSync = () => {
    bulkSync.mutate(undefined, {
      onSuccess: (data) => {
        showToast.success(`Synced ${data.succeeded}/${data.total} notes`);
        if (data.failed > 0) {
          showToast.error(`${data.failed} notes failed to sync`);
        }
      },
      onError: () => showToast.error("Bulk sync failed"),
    });
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Github className="h-5 w-5" />
          GitHub Sync
        </CardTitle>
        <CardDescription>
          Sync your notes to a GitHub repository as Markdown files. Every save becomes a Git commit, giving you full version history.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Connection status */}
        {connection && (
          <div className="flex items-center gap-2">
            <Badge variant="success" className="gap-1">
              <CheckCircle2 className="h-3 w-3" />
              Connected
            </Badge>
            {connection.github_username && (
              <span className="text-sm text-muted-foreground">@{connection.github_username}</span>
            )}
            {connection.last_sync_at && (
              <span className="text-xs text-muted-foreground">
                Last sync: {formatDistanceToNow(new Date(connection.last_sync_at), { addSuffix: true })}
              </span>
            )}
          </div>
        )}

        {/* Token */}
        <div className="space-y-2">
          <Label htmlFor="gh-token">
            Personal Access Token {connection && <span className="text-muted-foreground">(leave blank to keep current)</span>}
          </Label>
          <Input
            id="gh-token"
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={connection ? "••••••••" : "ghp_xxxxxxxxxxxx"}
          />
          <p className="text-xs text-muted-foreground">
            Create a token at{" "}
            <a href="https://github.com/settings/tokens/new?scopes=repo" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
              github.com/settings/tokens
            </a>{" "}
            with <code className="text-[10px] bg-muted px-1 rounded">repo</code> scope.
          </p>
        </div>

        <Separator />

        {/* Repository settings */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="gh-owner">Repository Owner</Label>
            <Input id="gh-owner" value={repoOwner} onChange={(e) => setRepoOwner(e.target.value)} placeholder="username" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="gh-repo">Repository Name</Label>
            <Input id="gh-repo" value={repoName} onChange={(e) => setRepoName(e.target.value)} placeholder="my-brain" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="gh-branch">Branch</Label>
            <Input id="gh-branch" value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="main" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="gh-vault">Vault Path</Label>
            <Input id="gh-vault" value={vaultPath} onChange={(e) => setVaultPath(e.target.value)} placeholder="/" />
            <p className="text-[10px] text-muted-foreground">Subdirectory within the repo. Use "/" for root.</p>
          </div>
        </div>

        <div className="space-y-2">
          <Label>Sync Direction</Label>
          <Select value={syncDirection} onValueChange={setSyncDirection}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="export">Export only (Menerio → GitHub)</SelectItem>
              <SelectItem value="import">Import only (GitHub → Menerio)</SelectItem>
              <SelectItem value="bidirectional">Bidirectional</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Separator />

        {/* Actions */}
        <div className="flex flex-wrap gap-2">
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {connection ? "Update Settings" : "Connect"}
          </Button>
          <Button variant="outline" onClick={handleTest} disabled={testing}>
            {testing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Test Connection
            {testResult === "success" && <CheckCircle2 className="ml-2 h-4 w-4 text-success" />}
            {testResult === "error" && <XCircle className="ml-2 h-4 w-4 text-destructive" />}
          </Button>
          {connection && (
            <>
              <Button variant="outline" onClick={handleBulkSync} disabled={bulkSync.isPending}>
                {bulkSync.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                Sync All Notes
              </Button>
              <Button variant="destructive" onClick={handleDisconnect} disabled={disconnecting}>
                {disconnecting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
                Disconnect
              </Button>
            </>
          )}
        </div>

        {/* Bulk sync progress */}
        {bulkSync.isPending && (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">Syncing notes to GitHub…</p>
            <Progress value={undefined} className="h-2" />
          </div>
        )}
        {bulkSync.data && !bulkSync.isPending && (
          <div className="text-sm text-muted-foreground">
            ✅ {bulkSync.data.succeeded} synced
            {bulkSync.data.failed > 0 && (
              <span className="text-destructive"> · ❌ {bulkSync.data.failed} failed</span>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
