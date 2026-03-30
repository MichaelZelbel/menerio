import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useGitHubConnection } from "@/hooks/useGitHubSync";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import {
  BarChart3,
  CheckCircle2,
  Clock,
  AlertTriangle,
  FileText,
  GitCommit,
  FolderTree,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface SyncStats {
  totalNotes: number;
  syncedNotes: number;
  pendingNotes: number;
  conflictNotes: number;
  errorNotes: number;
}

export function SyncDashboard() {
  const { user } = useAuth();
  const { data: connection } = useGitHubConnection();

  const { data: stats } = useQuery<SyncStats>({
    queryKey: ["github-sync-stats", user?.id],
    enabled: !!user && !!connection,
    queryFn: async () => {
      const [notesRes, syncRes] = await Promise.all([
        supabase
          .from("notes")
          .select("id", { count: "exact", head: true })
          .eq("user_id", user!.id)
          .eq("is_trashed", false),
        supabase
          .from("github_sync_log" as any)
          .select("sync_status")
          .eq("user_id", user!.id),
      ]);

      const totalNotes = (notesRes as any).count || 0;
      const syncEntries = (syncRes.data || []) as any[];
      const syncedNotes = syncEntries.filter((e: any) => e.sync_status === "synced").length;
      const conflictNotes = syncEntries.filter((e: any) => e.sync_status === "conflict").length;
      const errorNotes = syncEntries.filter((e: any) => e.sync_status === "error").length;
      const pendingNotes = totalNotes - syncedNotes;

      return { totalNotes, syncedNotes, pendingNotes, conflictNotes, errorNotes };
    },
    staleTime: 30_000,
  });

  const { data: recentActivity } = useQuery<any[]>({
    queryKey: ["github-sync-activity", user?.id],
    enabled: !!user && !!connection,
    queryFn: async () => {
      const { data } = await supabase
        .from("github_sync_log" as any)
        .select("id, note_id, github_path, sync_status, sync_direction, synced_at, error_message")
        .eq("user_id", user!.id)
        .order("synced_at", { ascending: false })
        .limit(20);
      return (data || []) as any[];
    },
    staleTime: 30_000,
  });

  if (!connection) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <BarChart3 className="h-4 w-4" />
          Sync Dashboard
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Stats grid */}
        {stats && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="text-center p-2 rounded-md bg-muted/50">
              <div className="text-2xl font-bold">{stats.syncedNotes}</div>
              <div className="text-[10px] text-muted-foreground flex items-center justify-center gap-1">
                <CheckCircle2 className="h-3 w-3" /> Synced
              </div>
            </div>
            <div className="text-center p-2 rounded-md bg-muted/50">
              <div className="text-2xl font-bold">{stats.pendingNotes}</div>
              <div className="text-[10px] text-muted-foreground flex items-center justify-center gap-1">
                <Clock className="h-3 w-3" /> Pending
              </div>
            </div>
            <div className="text-center p-2 rounded-md bg-muted/50">
              <div className="text-2xl font-bold">{stats.conflictNotes}</div>
              <div className="text-[10px] text-muted-foreground flex items-center justify-center gap-1">
                <AlertTriangle className="h-3 w-3" /> Conflicts
              </div>
            </div>
            <div className="text-center p-2 rounded-md bg-muted/50">
              <div className="text-2xl font-bold">{stats.totalNotes}</div>
              <div className="text-[10px] text-muted-foreground flex items-center justify-center gap-1">
                <FileText className="h-3 w-3" /> Total
              </div>
            </div>
          </div>
        )}

        {connection.last_sync_at && (
          <p className="text-xs text-muted-foreground">
            Last sync: {formatDistanceToNow(new Date(connection.last_sync_at), { addSuffix: true })}
          </p>
        )}

        <Separator />

        {/* Recent activity */}
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">Recent Sync Activity</p>
          <ScrollArea className="h-40">
            {recentActivity?.map((entry: any) => (
              <div key={entry.id} className="flex items-center gap-2 py-1 text-xs">
                <GitCommit className="h-3 w-3 shrink-0 text-muted-foreground" />
                <span className="truncate flex-1">
                  {(entry.github_path || "").split("/").pop()?.replace(".md", "") || "Unknown"}
                </span>
                <Badge
                  variant={
                    entry.sync_status === "synced"
                      ? "secondary"
                      : entry.sync_status === "conflict"
                        ? "destructive"
                        : "outline"
                  }
                  className="text-[9px] h-4 px-1"
                >
                  {entry.sync_direction === "export" ? "↑" : entry.sync_direction === "import" ? "↓" : "↔"}{" "}
                  {entry.sync_status}
                </Badge>
                {entry.synced_at && (
                  <span className="text-muted-foreground whitespace-nowrap">
                    {formatDistanceToNow(new Date(entry.synced_at), { addSuffix: true })}
                  </span>
                )}
              </div>
            ))}
            {(!recentActivity || recentActivity.length === 0) && (
              <p className="text-xs text-muted-foreground text-center py-4">No sync activity yet</p>
            )}
          </ScrollArea>
        </div>
      </CardContent>
    </Card>
  );
}

export function FolderMappingSettings() {
  const { user } = useAuth();
  const { data: connection } = useGitHubConnection();
  const [folderMode, setFolderMode] = useState(
    ((connection as any)?.metadata as any)?.folder_mode || "preserve"
  );

  const handleChange = async (value: string) => {
    setFolderMode(value);
    if (!user || !connection) return;
    await supabase
      .from("github_connections" as any)
      .update({
        // Store in vault_path metadata — we use the connection's metadata convention
        // For now store in a separate convention via sync_direction prefix
      })
      .eq("user_id", user.id);
  };

  if (!connection) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <FolderTree className="h-4 w-4" />
          Folder Structure
        </CardTitle>
        <CardDescription className="text-xs">
          How notes are organized in your GitHub repository.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          <Label className="text-sm">Organization Mode</Label>
          <Select value={folderMode} onValueChange={setFolderMode}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="flat">Flat — all notes in root folder</SelectItem>
              <SelectItem value="preserve">Preserve — keep Obsidian folder structure</SelectItem>
              <SelectItem value="by_type">By type — organize by note type (meetings, daily, etc.)</SelectItem>
              <SelectItem value="by_tag">By tag — first tag becomes folder name</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-[10px] text-muted-foreground">
            {folderMode === "flat" && "All notes will be stored in the vault root or configured path."}
            {folderMode === "preserve" && "Imported folder structure from Obsidian will be maintained."}
            {folderMode === "by_type" && "Notes are placed in folders matching their type (e.g., Meetings/, Daily Notes/)."}
            {folderMode === "by_tag" && "The first tag on each note determines its folder."}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
