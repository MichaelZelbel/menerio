import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Loader2, HardDrive, ChevronRight, Folder, Home, RefreshCw, Trash2, CheckCircle2 } from "lucide-react";
import { showToast } from "@/lib/toast";
import { formatDistanceToNow } from "date-fns";

interface GDriveConnection {
  connected?: boolean;
  google_email?: string | null;
  watch_folder_id?: string | null;
  watch_folder_name?: string | null;
  target_note_folder?: string | null;
  sync_enabled?: boolean;
  last_sync_at?: string | null;
  last_error?: string | null;
}

interface GDriveImport {
  id: string;
  file_name: string | null;
  status: string;
  imported_at: string;
}

interface DriveFolder {
  id: string;
  name: string;
}


async function callProxy<T = unknown>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("gdrive-proxy", { body });
  if (error) throw new Error((data as { error?: string } | null)?.error || error.message);
  if ((data as { error?: string } | null)?.error) throw new Error((data as { error: string }).error);
  return data as T;
}

export function GoogleDriveScans() {
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [connection, setConnection] = useState<GDriveConnection | null>(null);

  const [folders, setFolders] = useState<DriveFolder[]>([]);
  const [breadcrumb, setBreadcrumb] = useState<DriveFolder[]>([]);
  const [browsing, setBrowsing] = useState(false);
  const [targetFolder, setTargetFolder] = useState("auto-import");
  const [saving, setSaving] = useState(false);
  const popupRef = useRef<Window | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [imports, setImports] = useState<GDriveImport[]>([]);

  const loadImports = useCallback(async () => {
    const { data } = await supabase
      .from("gdrive_imports")
      .select("id, file_name, status, imported_at")
      .order("imported_at", { ascending: false })
      .limit(10);
    setImports((data as GDriveImport[] | null) ?? []);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const res = await callProxy<{ connection: GDriveConnection | null }>({ action: "status" });
      setConnection(res.connection);
      setTargetFolder(res.connection?.target_note_folder || "auto-import");
      if (res.connection?.connected) await loadImports();
    } catch (e) {
      console.error("gdrive status failed", e);
    } finally {
      setLoading(false);
    }
  }, [loadImports]);

  const handleSyncNow = useCallback(async () => {
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke("gdrive-sync", { body: {} });
      if (error) throw error;
      const res = (data ?? {}) as { imported?: number; failed?: number };
      showToast.success(
        res.imported ? `Imported ${res.imported} file${res.imported === 1 ? "" : "s"}` : "No new scans found",
      );
      await loadImports();
      await refresh();
    } catch (e) {
      showToast.error(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  }, [loadImports, refresh]);



  useEffect(() => {
    refresh();
  }, [refresh]);

  const completeAuth = useCallback(
    async (code: string) => {
      setConnecting(true);
      try {
        await callProxy({ action: "complete_auth", code });
        showToast.success("Google Drive connected");
        await refresh();
      } catch (e) {
        showToast.error(e instanceof Error ? e.message : "Could not connect Google Drive");
      } finally {
        setConnecting(false);
      }
    },
    [refresh],
  );

  // Listen for the popup handing back the exchange code.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data as { type?: string; code?: string; error?: string } | null;
      if (!data || data.type !== "gdrive-oauth") return;
      popupRef.current?.close();
      if (data.error) {
        setConnecting(false);
        showToast.error(data.error);
        return;
      }
      if (data.code) completeAuth(data.code);
    };
    window.addEventListener("message", onMessage);

    // Same-tab fallback.
    const stored = sessionStorage.getItem("gdrive-oauth");
    if (stored) {
      sessionStorage.removeItem("gdrive-oauth");
      try {
        const parsed = JSON.parse(stored) as { code?: string; error?: string };
        if (parsed.error) showToast.error(parsed.error);
        else if (parsed.code) completeAuth(parsed.code);
      } catch {
        /* ignore */
      }
    }

    return () => window.removeEventListener("message", onMessage);
  }, [completeAuth]);

  const handleConnect = async () => {
    setConnecting(true);
    try {
      const res = await callProxy<{ authorization_url: string }>({
        action: "start_auth",
        return_url: `${window.location.origin}/gdrive-callback`,
      });
      popupRef.current = window.open(res.authorization_url, "gdrive-oauth", "width=520,height=680");
      if (!popupRef.current) {
        setConnecting(false);
        showToast.error("Please allow popups to connect Google Drive");
      }
    } catch (e) {
      setConnecting(false);
      showToast.error(e instanceof Error ? e.message : "Could not start Google authorization");
    }
  };

  const browse = async (parent: DriveFolder | null) => {
    setBrowsing(true);
    try {
      const res = await callProxy<{ folders: DriveFolder[] }>({
        action: "list_folders",
        parent_id: parent?.id || "root",
      });
      setFolders(res.folders || []);
      if (!parent) setBreadcrumb([]);
    } catch (e) {
      showToast.error(e instanceof Error ? e.message : "Could not list Drive folders");
    } finally {
      setBrowsing(false);
    }
  };

  const openFolder = async (folder: DriveFolder) => {
    setBreadcrumb((b) => [...b, folder]);
    await browse(folder);
  };

  const goToCrumb = async (index: number) => {
    if (index < 0) {
      setBreadcrumb([]);
      await browse(null);
      return;
    }
    const next = breadcrumb.slice(0, index + 1);
    setBreadcrumb(next);
    await browse(next[next.length - 1]);
  };

  const saveSettings = async (updates: Record<string, unknown>) => {
    setSaving(true);
    try {
      const res = await callProxy<{ connection: GDriveConnection }>({ action: "save_settings", ...updates });
      setConnection(res.connection);
      showToast.success("Saved");
    } catch (e) {
      showToast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSaving(false);
    }
  };

  const handleDisconnect = async () => {
    setSaving(true);
    try {
      await callProxy({ action: "disconnect" });
      setConnection(null);
      setFolders([]);
      setBreadcrumb([]);
      showToast.success("Google Drive disconnected");
    } catch (e) {
      showToast.error(e instanceof Error ? e.message : "Could not disconnect");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading Google Drive settings…
        </CardContent>
      </Card>
    );
  }

  const isConnected = Boolean(connection?.connected);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <HardDrive className="h-4 w-4" /> Google Drive scans
            </CardTitle>
            <CardDescription>
              Drop PDFs or photos of scans into one Drive folder and they arrive here as notes, with the
              text extracted and a title generated automatically.
            </CardDescription>
          </div>
          {isConnected ? (
            <Badge variant="secondary" className="gap-1">
              <CheckCircle2 className="h-3 w-3" /> Connected
            </Badge>
          ) : (
            <Badge variant="outline">Not connected</Badge>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {!isConnected ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              You will be asked to sign in with Google and grant read-only access to your Drive. Files are
              never modified or deleted.
            </p>
            <Button onClick={handleConnect} disabled={connecting}>
              {connecting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Connect Google Drive
            </Button>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm">
                <div className="font-medium">{connection?.google_email || "Google account"}</div>
                <div className="text-muted-foreground">
                  {connection?.last_sync_at
                    ? `Last sync ${formatDistanceToNow(new Date(connection.last_sync_at), { addSuffix: true })}`
                    : "No sync yet"}
                </div>
              </div>
              <Button variant="ghost" size="sm" onClick={handleDisconnect} disabled={saving}>
                <Trash2 className="mr-2 h-4 w-4" /> Disconnect
              </Button>
            </div>

            {connection?.last_error ? (
              <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{connection.last_error}</p>
            ) : null}

            <Separator />

            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <Label>Watched Drive folder</Label>
                <Button variant="outline" size="sm" onClick={() => browse(null)} disabled={browsing}>
                  {browsing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                  Browse Drive
                </Button>
              </div>
              <p className="text-sm text-muted-foreground">
                {connection?.watch_folder_name
                  ? `Currently watching “${connection.watch_folder_name}”`
                  : "No folder selected yet."}
              </p>

              {folders.length > 0 || breadcrumb.length > 0 ? (
                <div className="rounded-md border">
                  <div className="flex flex-wrap items-center gap-1 border-b px-3 py-2 text-xs text-muted-foreground">
                    <button className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => goToCrumb(-1)}>
                      <Home className="h-3 w-3" /> My Drive
                    </button>
                    {breadcrumb.map((c, i) => (
                      <span key={c.id} className="inline-flex items-center gap-1">
                        <ChevronRight className="h-3 w-3" />
                        <button className="hover:text-foreground" onClick={() => goToCrumb(i)}>
                          {c.name}
                        </button>
                      </span>
                    ))}
                  </div>
                  <div className="max-h-64 overflow-y-auto">
                    {folders.length === 0 ? (
                      <div className="px-3 py-4 text-sm text-muted-foreground">No subfolders here.</div>
                    ) : (
                      folders.map((f) => (
                        <div key={f.id} className="flex items-center justify-between gap-2 border-b px-3 py-2 last:border-b-0">
                          <button
                            className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm hover:underline"
                            onClick={() => openFolder(f)}
                          >
                            <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
                            <span className="truncate">{f.name}</span>
                          </button>
                          <Button
                            size="sm"
                            variant={connection?.watch_folder_id === f.id ? "secondary" : "outline"}
                            disabled={saving}
                            onClick={() => saveSettings({ watch_folder_id: f.id, watch_folder_name: f.name })}
                          >
                            {connection?.watch_folder_id === f.id ? "Watching" : "Watch this"}
                          </Button>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              ) : null}
            </div>

            <Separator />

            <div className="space-y-2">
              <Label htmlFor="gdrive-target">Target note folder</Label>
              <div className="flex gap-2">
                <Input
                  id="gdrive-target"
                  value={targetFolder}
                  onChange={(e) => setTargetFolder(e.target.value)}
                  placeholder="auto-import"
                />
                <Button
                  variant="outline"
                  disabled={saving || targetFolder === (connection?.target_note_folder || "")}
                  onClick={() => saveSettings({ target_note_folder: targetFolder })}
                >
                  Save
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">Imported scans are filed into this note folder.</p>
            </div>

            <div className="flex items-center justify-between gap-3">
              <div>
                <Label>Import enabled</Label>
                <p className="text-xs text-muted-foreground">Pause importing without disconnecting.</p>
              </div>
              <Switch
                checked={connection?.sync_enabled !== false}
                disabled={saving}
                onCheckedChange={(v) => saveSettings({ sync_enabled: v })}
              />
            </div>

            <Separator />

            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <Label>Recent imports</Label>
                  <p className="text-xs text-muted-foreground">
                    New scans normally arrive within a minute of landing in the folder.
                  </p>
                </div>
                <Button variant="outline" size="sm" onClick={handleSyncNow} disabled={syncing}>
                  {syncing ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" />
                  )}
                  Sync now
                </Button>
              </div>

              {imports.length === 0 ? (
                <p className="text-xs text-muted-foreground">Nothing imported yet.</p>
              ) : (
                <ul className="space-y-1.5">
                  {imports.map((imp) => (
                    <li key={imp.id} className="flex items-center justify-between gap-3 text-sm">
                      <span className="truncate">{imp.file_name || "Untitled file"}</span>
                      <span className="flex shrink-0 items-center gap-2">
                        <Badge
                          variant={imp.status === "imported" ? "secondary" : "outline"}
                          className="text-[10px]"
                        >
                          {imp.status}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {formatDistanceToNow(new Date(imp.imported_at), { addSuffix: true })}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

          </>
        )}
      </CardContent>
    </Card>
  );
}
