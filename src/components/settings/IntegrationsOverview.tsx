import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
} from "lucide-react";

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
  | "mcp"
  | "apikeys";

type Statuses = Partial<Record<StatusKey, boolean>>;

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
  { key: "integrations", tab: "integrations", name: "Slack", description: "Send Slack messages straight to Menerio", icon: MessageSquare },
  { key: "singlefile", tab: "singlefile", name: "Web Clipper", description: "Save web pages as Markdown notes", icon: Globe },
  { key: "github", tab: "github", name: "GitHub Sync", description: "Two-way sync with an Obsidian vault", icon: Github },
  { key: "mcp", tab: "mcp", name: "MCP Server", description: "Connect Claude / ChatGPT via MCP tokens", icon: Brain },
  { key: "apikeys", tab: "apikeys", name: "Hub API Keys", description: "Bearer keys (mnr_) for the Hub REST API", icon: Key },
];

export function IntegrationsOverview({ onOpenTab }: IntegrationsOverviewProps) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [statuses, setStatuses] = useState<Statuses>({});

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    (async () => {
      setLoading(true);

      const [
        connectedApps,
        telegram,
        discord,
        github,
        mcp,
      ] = await Promise.all([
        supabase
          .from("connected_apps" as never)
          .select("id, app_type", { count: "exact", head: false })
          .eq("user_id", user.id)
          .eq("is_active", true),
        supabase
          .from("telegram_connections" as never)
          .select("id", { count: "exact", head: true })
          .eq("user_id", user.id)
          .not("telegram_user_id", "is", null),
        supabase
          .from("discord_connections" as never)
          .select("id", { count: "exact", head: true })
          .eq("user_id", user.id)
          .not("discord_user_id", "is", null),
        supabase
          .from("github_connections" as never)
          .select("id", { count: "exact", head: true })
          .eq("user_id", user.id),
        supabase
          .from("mcp_api_tokens" as never)
          .select("id", { count: "exact", head: true })
          .eq("user_id", user.id)
          .eq("is_active", true),
      ]);

      // Detect Slack (connected_apps with type slack)
      const apps = (connectedApps.data as Array<{ app_type?: string }> | null) || [];
      const slackOn = apps.some((a) => (a.app_type || "").toLowerCase().includes("slack"));
      const otherApps = apps.filter((a) => !((a.app_type || "").toLowerCase().includes("slack"))).length > 0;

      // API keys via edge function
      let apiKeysOn = false;
      let singleFileOn = false;
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await supabase.functions.invoke("hub-api-keys", {
          headers: { Authorization: `Bearer ${session?.access_token}` },
        });
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
      } catch {
        // ignore — function may not be reachable
      }

      if (cancelled) return;

      setStatuses({
        connections: otherApps,
        telegram: (telegram.count || 0) > 0,
        discord: (discord.count || 0) > 0,
        integrations: slackOn,
        singlefile: singleFileOn,
        github: (github.count || 0) > 0,
        mcp: (mcp.count || 0) > 0,
        apikeys: apiKeysOn,
      });
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [user]);

  const connectedCount = Object.values(statuses).filter(Boolean).length;
  const total = INTEGRATIONS.length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Plug className="h-5 w-5 text-primary" />
          Integrations
        </CardTitle>
        <CardDescription className="flex items-center gap-2 pt-1">
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
                Available: {total - connectedCount}
              </Badge>
            </>
          )}
        </CardDescription>
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
