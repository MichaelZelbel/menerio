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
import { Loader2, CheckCircle2, ExternalLink, Copy, Gamepad2, Unplug, Terminal } from "lucide-react";

interface DiscordConnection {
  id: string;
  user_id: string;
  discord_guild_id: string;
  discord_channel_id: string | null;
  bot_token: string;
  application_id: string;
  public_key: string;
  is_active: boolean;
  created_at: string;
}

export function DiscordIntegration() {
  const { user } = useAuth();
  const [botToken, setBotToken] = useState("");
  const [applicationId, setApplicationId] = useState("");
  const [publicKey, setPublicKey] = useState("");
  const [guildId, setGuildId] = useState("");
  const [channelId, setChannelId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [testing, setTesting] = useState(false);
  const [connection, setConnection] = useState<DiscordConnection | null>(null);

  const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID || "tjeapelvjlmbxafsmjef";
  const interactionsUrl = `https://${projectRef}.supabase.co/functions/v1/discord-capture`;

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase
        .from("discord_connections" as any)
        .select("*")
        .eq("user_id", user.id)
        .single();
      if (data) {
        const conn = data as unknown as DiscordConnection;
        setConnection(conn);
        setBotToken(conn.bot_token);
        setApplicationId(conn.application_id);
        setPublicKey(conn.public_key);
        setGuildId(conn.discord_guild_id);
        setChannelId(conn.discord_channel_id || "");
      }
      setLoading(false);
    })();
  }, [user]);

  const handleSave = async () => {
    if (!user || !botToken.trim() || !applicationId.trim() || !publicKey.trim() || !guildId.trim()) return;
    setSaving(true);
    try {
      const payload = {
        bot_token: botToken.trim(),
        application_id: applicationId.trim(),
        public_key: publicKey.trim(),
        discord_guild_id: guildId.trim(),
        discord_channel_id: channelId.trim() || null,
        is_active: true,
      };

      if (connection) {
        await supabase
          .from("discord_connections" as any)
          .update(payload)
          .eq("id", connection.id);
      } else {
        await supabase
          .from("discord_connections" as any)
          .insert({ ...payload, user_id: user.id });
      }

      // Reload
      const { data: updated } = await supabase
        .from("discord_connections" as any)
        .select("*")
        .eq("user_id", user.id)
        .single();
      if (updated) setConnection(updated as unknown as DiscordConnection);

      showToast.success("Discord connection saved");
    } catch (err: any) {
      showToast.error(err.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const handleRegisterSlash = async () => {
    setRegistering(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(
        `${interactionsUrl}?action=register-slash`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session?.access_token}`,
            "Content-Type": "application/json",
          },
          body: "{}",
        }
      );
      const data = await res.json();
      if (data.ok) {
        showToast.success("Slash command /capture registered! It may take up to an hour to appear globally.");
      } else {
        showToast.error(data.error || "Failed to register slash command");
      }
    } catch {
      showToast.error("Failed to register slash command");
    } finally {
      setRegistering(false);
    }
  };

  const handleTest = async () => {
    if (!connection?.discord_channel_id) {
      showToast.error("Set a capture channel ID to send a test message");
      return;
    }
    setTesting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(
        `${interactionsUrl}?action=test`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session?.access_token}`,
            "Content-Type": "application/json",
          },
          body: "{}",
        }
      );
      const data = await res.json();
      if (data.ok) {
        showToast.success("Test message sent to Discord channel!");
      } else {
        showToast.error(data.error || "Failed to send test");
      }
    } catch {
      showToast.error("Failed to reach Discord");
    } finally {
      setTesting(false);
    }
  };

  const handleDisconnect = async () => {
    if (!connection) return;
    await supabase
      .from("discord_connections" as any)
      .update({ is_active: false })
      .eq("id", connection.id);
    setConnection({ ...connection, is_active: false });
    showToast.success("Discord disconnected");
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

  const isConnected = connection?.is_active;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#5865F2]">
              <Gamepad2 className="h-5 w-5 text-white" />
            </div>
            <div>
              <CardTitle className="text-base">Discord Capture</CardTitle>
              <CardDescription>Capture thoughts via Discord bot or /capture command</CardDescription>
            </div>
          </div>
          {isConnected && (
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
                  <a href="https://discord.com/developers/applications" target="_blank" rel="noopener" className="text-primary hover:underline inline-flex items-center gap-0.5">
                    discord.com/developers/applications <ExternalLink className="h-3 w-3" />
                  </a>{" "}
                  → <strong>New Application</strong>
                </li>
                <li>
                  Copy the <strong>Application ID</strong> and <strong>Public Key</strong> from the General Information page
                </li>
                <li>
                  Go to <strong>Bot</strong> tab → Reset Token → copy the <strong>Bot Token</strong>
                </li>
                <li>
                  Go to <strong>OAuth2</strong> → URL Generator → select <code className="bg-muted px-1 rounded text-xs">bot</code> scope → select permissions:
                  <div className="flex gap-1 mt-1 flex-wrap">
                    <Badge variant="secondary" className="text-[10px]">Send Messages</Badge>
                    <Badge variant="secondary" className="text-[10px]">Read Message History</Badge>
                  </div>
                </li>
                <li>Use the generated URL to <strong>invite the bot</strong> to your server</li>
                <li>
                  Set the <strong>Interactions Endpoint URL</strong> in General Information:
                  <div className="mt-1 flex items-center gap-1.5">
                    <code className="text-[10px] bg-muted px-2 py-1 rounded break-all">{interactionsUrl}</code>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 shrink-0"
                      onClick={() => {
                        navigator.clipboard.writeText(interactionsUrl);
                        showToast.copied();
                      }}
                    >
                      <Copy className="h-3 w-3" />
                    </Button>
                  </div>
                </li>
                <li>Paste all credentials below and click <strong>Save</strong></li>
                <li>Click <strong>Register /capture command</strong> to enable the slash command</li>
              </ol>
            </AccordionContent>
          </AccordionItem>
        </Accordion>

        <Separator />

        {/* Config fields */}
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="dc-token" className="text-xs">Bot Token</Label>
            <Input
              id="dc-token"
              type="password"
              value={botToken}
              onChange={(e) => setBotToken(e.target.value)}
              placeholder="MTIzNDU2Nzg5..."
              className="font-mono text-sm"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="dc-appid" className="text-xs">Application ID</Label>
              <Input
                id="dc-appid"
                value={applicationId}
                onChange={(e) => setApplicationId(e.target.value)}
                placeholder="123456789012345678"
                className="font-mono text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dc-pubkey" className="text-xs">Public Key</Label>
              <Input
                id="dc-pubkey"
                value={publicKey}
                onChange={(e) => setPublicKey(e.target.value)}
                placeholder="abc123def456..."
                className="font-mono text-sm"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="dc-guild" className="text-xs">Server (Guild) ID</Label>
              <Input
                id="dc-guild"
                value={guildId}
                onChange={(e) => setGuildId(e.target.value)}
                placeholder="123456789012345678"
                className="font-mono text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dc-channel" className="text-xs">
                Capture Channel ID <span className="text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="dc-channel"
                value={channelId}
                onChange={(e) => setChannelId(e.target.value)}
                placeholder="123456789012345678"
                className="font-mono text-sm"
              />
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 flex-wrap">
          <Button onClick={handleSave} disabled={saving || !botToken.trim() || !applicationId.trim() || !publicKey.trim() || !guildId.trim()} size="sm">
            {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Save
          </Button>
          {isConnected && (
            <>
              <Button variant="outline" size="sm" onClick={handleRegisterSlash} disabled={registering}>
                {registering ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Terminal className="mr-1.5 h-3.5 w-3.5" />}
                Register /capture
              </Button>
              <Button variant="outline" size="sm" onClick={handleTest} disabled={testing}>
                {testing && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                Test Connection
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={handleDisconnect}
              >
                <Unplug className="h-3.5 w-3.5 mr-1" />
                Disconnect
              </Button>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
