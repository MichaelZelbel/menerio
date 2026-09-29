import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Plug,
  MessageSquare,
  Send,
  Gamepad2,
  Github,
  Globe,
  Brain,
  Key,
  ChevronRight,
  Loader2,
  CheckCircle2,
  Circle,
  CircleHelp,
  HardDrive,
} from "lucide-react";
import { BRAND } from "@/lib/brand";

interface IntegrationsOverviewProps {
  onOpenTab: (tab: string) => void;
}

type StatusKey =
  | "connections"
  | "telegram"
  | "discord"
  | "integrations"
  | "singlefile"
  | "github"
  | "gdrive"
  | "mcp"
  | "apikeys";

// true = connected, false = not connected, null = the check itself failed, so
// the overview does not know (and must not claim "Not connected").
type Statuses = Partial<Record<StatusKey, boolean | null>>;

interface IntegrationDef {
  key: StatusKey;
  tab: string;
  name: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}

const INTEGRATIONS: IntegrationDef[] = [
  { key: "connections", tab: "connections", name: "Connected Apps", description: "External apps with x-api-key access", icon: Plug },
  { key: "telegram", tab: "telegram", name: "Telegram", description: "Capture notes via Telegram bot", icon: Send },
  { key: "discord", tab: "discord", name: "Discord", description: "Capture notes via /capture slash command", icon: Gamepad2 },
  { key: "integrations", tab: "integrations", name: "Slack", description: `Send Slack messages straight to ${BRAND.name}`, icon: MessageSquare },
  { key: "singlefile", tab: "singlefile", name: "Web Clipper", description: "Save web pages as Markdown notes", icon: Globe },
  { key: "github", tab: "github", name: "GitHub Sync", description: "Two-way sync with an Obsidian vault", icon: Github },
  { key: "gdrive", tab: "gdrive", name: "Google Drive Scans", description: "Auto-import scans from a Drive folder", icon: HardDrive },
  { key: "apikeys", tab: "apikeys", name: "API Keys", description: "One key (mnr_) for Claude, ChatGPT, your mission control and the REST API", icon: Key },
  { key: "mcp", tab: "mcp", name: "MCP Server", description: "The address your AI tool connects to, plus older tokens", icon: Brain },
];

export function IntegrationsOverview({ onOpenTab }: IntegrationsOverviewProps) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [statuses, setStatuses] = useState<Statuses>({});

  const userId = user?.id;

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;

    (async () => {
      setLoading(true);

      // Each filter names a column the table really has. The old ones
      // (connected_apps.app_type, telegram_user_id, discord_user_id,
      // mcp_api_tokens.is_active) do not exist, so every query failed and every
      // integration read "Not connected".
      const [
        connectedApps,
        telegram,
        discord,
        github,
        gdrive,
        mcp,
      ] = await Promise.all([
        supabase
          .from("connected_apps" as never)
          .select("app_name, connection_status")
          .eq("user_id", userId)
          .eq("is_active", true),
        supabase
          .from("telegram_connections" as never)
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId)
          .eq("is_active", true)
          .eq("is_paired", true),
        supabase
          .from("discord_connections" as never)
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId)
          .eq("is_active", true),
        supabase
          .from("github_connections" as never)
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId),
        supabase
          .from("gdrive_connections" as never)
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId),
        supabase
          .from("mcp_api_tokens" as never)
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId)
          .is("revoked_at", null),
      ]);

      const hasRows = (res: { error: unknown; count: number | null }) =>
        res.error ? null : (res.count || 0) > 0;

      // Slack is the connected_apps row named "slack"; the other rows are the
      // apps on the Apps tab, connected once their handshake finished.
      let slackOn: boolean | null = null;
      let otherApps: boolean | null = null;
      if (!connectedApps.error) {
        const apps = (connectedApps.data as Array<{ app_name?: string; connection_status?: string }> | null) || [];
        slackOn = apps.some((a) => a.app_name === "slack");
        otherApps = apps.some((a) => a.app_name !== "slack" && a.connection_status === "active");
      }

      // API keys via edge function
      let apiKeysOn: boolean | null = null;
      let singleFileOn: boolean | null = null;
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await supabase.functions.invoke("mc-api-keys", {
          // Without a method, invoke sends POST, and the function answers a bare POST with
          // 404: the overview then counted zero keys for everybody. Seen in the console 2026-09-21.
          method: "GET",
          headers: { Authorization: `Bearer ${session?.access_token}` },
        });
        if (!res.error && !res.data?.error) {
          const list = (res.data?.keys || res.data || []) as Array<{ is_active?: boolean; scopes?: string[]; name?: string }>;
          const active = list.filter((k) => k.is_active !== false);
          apiKeysOn = active.length > 0;
          singleFileOn = active.some(
            (k) =>
              (k.scopes || []).includes("notes") &&
              ((k.name || "").toLowerCase().includes("singlefile") ||
                (k.name || "").toLowerCase().includes("clipper") ||
                (k.name || "").toLowerCase().includes("web")),
          );
        }
      } catch {
        // Unreachable function: the two statuses stay unknown.
      }

      if (cancelled) return;

      setStatuses({
        connections: otherApps,
        telegram: hasRows(telegram),
        discord: hasRows(discord),
        integrations: slackOn,
        singlefile: singleFileOn,
        github: hasRows(github),
        gdrive: hasRows(gdrive),
        mcp: hasRows(mcp),
        apikeys: apiKeysOn,
      });
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [userId]);

  const connectedCount = Object.values(statuses).filter((v) => v === true).length;
  const notConnectedCount = Object.values(statuses).filter((v) => v === false).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Plug className="h-5 w-5 text-primary" />
          Integrations
        </CardTitle>
        {/* A div, not CardDescription's <p>: the badges are divs. */}
        <div className="flex items-center gap-2 pt-1 text-sm text-muted-foreground">
          {loading ? (
            <span className="flex items-center gap-1.5 text-xs">
              <Loader2 className="h-3 w-3 animate-spin" />
              Checking…
            </span>
          ) : (
            <>
              <Badge variant="secondary" className="text-xs">
                Connected: {connectedCount}
              </Badge>
              <Badge variant="outline" className="text-xs">
                Available: {notConnectedCount}
              </Badge>
            </>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-border rounded-md border border-border">
          {INTEGRATIONS.map(({ key, tab, name, description, icon: Icon }) => {
            const connected = statuses[key];
            return (
              <li key={key}>
                <button
                  type="button"
                  onClick={() => onOpenTab(tab)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-accent/40 transition-colors"
                >
                  <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate">{name}</span>
                      {loading ? null : connected ? (
                        <span className="inline-flex items-center gap-1 text-[10px] text-success">
                          <CheckCircle2 className="h-3 w-3" />
                          Connected
                        </span>
                      ) : connected !== false ? (
                        <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                          <CircleHelp className="h-3 w-3" />
                          Could not check
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                          <Circle className="h-3 w-3" />
                          Not connected
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground truncate">{description}</p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                </button>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
