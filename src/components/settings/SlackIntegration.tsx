import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { showToast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Loader2, CheckCircle2, ExternalLink, Copy, MessageSquare } from "lucide-react";

export function SlackIntegration() {
  const { user } = useAuth();
  const [botToken, setBotToken] = useState("");
  const [channelId, setChannelId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [connected, setConnected] = useState(false);
  const [appId, setAppId] = useState<string | null>(null);

  const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID || "tjeapelvjlmbxafsmjef";
  const captureUrl = `https://${projectRef}.supabase.co/functions/v1/slack-capture`;

  // Load existing config
  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase
        .from("connected_apps" as any)
        .select("id, permissions")
        .eq("user_id", user.id)
        .eq("app_name", "slack")
        .single();
      if (data) {
        const perms = data.permissions as Record<string, unknown> | null;
        setAppId(data.id);
        setBotToken((perms?.bot_token as string) || "");
        setChannelId((perms?.channel_id as string) || "");
        setConnected(!!perms?.bot_token);
      }
      setLoading(false);
    })();
  }, [user]);

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);
    try {
      const permissions = {
        bot_token: botToken.trim(),
        channel_id: channelId.trim(),
        can_push_notes: true,
        can_receive_patches: false,
      };

      if (appId) {
        await supabase
          .from("connected_apps" as any)
          .update({ permissions, is_active: !!botToken.trim() })
          .eq("id", appId);
      } else {
        const apiKey = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
        const { data } = await supabase
          .from("connected_apps" as any)
          .insert({
            user_id: user.id,
            app_name: "slack",
            display_name: "Slack",
            api_key: apiKey,
            permissions,
          })
          .select("id")
          .single();
        if (data) setAppId(data.id);
      }
      setConnected(!!botToken.trim());
      showToast.success("Slack integration saved");
    } catch {
      showToast.error("Failed to save Slack settings");
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    if (!botToken.trim() || !channelId.trim()) {
      showToast.error("Enter both Bot Token and Channel ID first");
      return;
    }
    setTesting(true);
    try {
      const res = await fetch("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${botToken.trim()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          channel: channelId.trim(),
          text: "🧠 Menerio is connected! Your thoughts in this channel will be captured automatically.",
        }),
      });
      const data = await res.json();
      if (data.ok) {
        showToast.success("Test message sent to Slack!");
      } else {
        showToast.error(`Slack error: ${data.error}`);
      }
    } catch {
      showToast.error("Failed to reach Slack API");
    } finally {
      setTesting(false);
    }
  };

  const handleDisconnect = async () => {
    if (!appId) return;
    await supabase
      .from("connected_apps" as any)
      .update({ is_active: false, permissions: {} })
      .eq("id", appId);
    setBotToken("");
    setChannelId("");
    setConnected(false);
    showToast.success("Slack disconnected");
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#4A154B]">
              <MessageSquare className="h-5 w-5 text-white" />
            </div>
            <div>
              <CardTitle className="text-base">Slack Capture</CardTitle>
              <CardDescription>Auto-capture thoughts from a Slack channel</CardDescription>
            </div>
          </div>
          {connected && (
            <Badge variant="outline" className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30">
              <CheckCircle2 className="h-3 w-3 mr-1" /> Connected
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Setup guide */}
        <Accordion type="single" collapsible>
          <AccordionItem value="setup">
            <AccordionTrigger className="text-sm">Setup Guide</AccordionTrigger>
            <AccordionContent className="space-y-3 text-sm text-muted-foreground">
              <ol className="list-decimal list-inside space-y-2">
                <li>
                  Go to{" "}
                  <a href="https://api.slack.com/apps" target="_blank" rel="noopener" className="text-primary hover:underline inline-flex items-center gap-0.5">
                    api.slack.com/apps <ExternalLink className="h-3 w-3" />
                  </a>{" "}
                  → <strong>Create New App</strong> → From Scratch
                </li>
                <li>
                  Go to <strong>OAuth & Permissions</strong> → Add Bot Token Scopes:
                  <div className="flex gap-1 mt-1 flex-wrap">
                    <Badge variant="secondary" className="text-[10px]">chat:write</Badge>
                    <Badge variant="secondary" className="text-[10px]">channels:history</Badge>
                    <Badge variant="secondary" className="text-[10px]">groups:history</Badge>
                  </div>
                </li>
                <li>
                  Go to <strong>Event Subscriptions</strong> → Enable Events → Set Request URL:
                  <div className="mt-1 flex items-center gap-1.5">
                    <code className="text-[10px] bg-muted px-2 py-1 rounded break-all">{captureUrl}</code>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 shrink-0"
                      onClick={() => {
                        navigator.clipboard.writeText(captureUrl);
                        showToast.success("URL copied");
                      }}
                    >
                      <Copy className="h-3 w-3" />
                    </Button>
                  </div>
                </li>
                <li>
                  Under <strong>Subscribe to bot events</strong>, add:
                  <div className="flex gap-1 mt-1 flex-wrap">
                    <Badge variant="secondary" className="text-[10px]">message.channels</Badge>
                    <Badge variant="secondary" className="text-[10px]">message.groups</Badge>
                  </div>
                </li>
                <li>
                  <strong>Install to Workspace</strong> and copy the <strong>Bot User OAuth Token</strong>
                </li>
                <li>
                  Get the <strong>Channel ID</strong>: right-click on the channel → "View channel details" → copy the ID at the bottom
                </li>
              </ol>
            </AccordionContent>
          </AccordionItem>
        </Accordion>

        <Separator />

        {/* Config fields */}
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="slack-token" className="text-xs">Bot User OAuth Token</Label>
            <Input
              id="slack-token"
              type="password"
              value={botToken}
              onChange={(e) => setBotToken(e.target.value)}
              placeholder="xoxb-..."
              className="font-mono text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="slack-channel" className="text-xs">Capture Channel ID</Label>
            <Input
              id="slack-channel"
              value={channelId}
              onChange={(e) => setChannelId(e.target.value)}
              placeholder="C0123456789"
              className="font-mono text-sm"
            />
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          <Button onClick={handleSave} disabled={saving} size="sm">
            {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Save
          </Button>
          <Button variant="outline" size="sm" onClick={handleTest} disabled={testing || !botToken.trim()}>
            {testing && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Test Connection
          </Button>
          {connected && (
            <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={handleDisconnect}>
              Disconnect
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
