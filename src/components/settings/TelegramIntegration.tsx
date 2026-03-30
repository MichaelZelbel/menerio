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
import { Loader2, CheckCircle2, ExternalLink, Copy, Send, Unplug } from "lucide-react";

function generatePairingCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

interface TelegramConnection {
  id: string;
  user_id: string;
  telegram_chat_id: number | null;
  bot_token: string;
  webhook_secret: string;
  pairing_code: string | null;
  is_active: boolean;
  is_paired: boolean;
  created_at: string;
}

export function TelegramIntegration() {
  const { user } = useAuth();
  const [botToken, setBotToken] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [connection, setConnection] = useState<TelegramConnection | null>(null);

  const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID || "tjeapelvjlmbxafsmjef";

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase
        .from("telegram_connections" as any)
        .select("*")
        .eq("user_id", user.id)
        .single();
      if (data) {
        const conn = data as unknown as TelegramConnection;
        setConnection(conn);
        setBotToken(conn.bot_token);
      }
      setLoading(false);
    })();
  }, [user]);

  const handleConnect = async () => {
    if (!user || !botToken.trim()) return;
    setSaving(true);
    try {
      const pairingCode = generatePairingCode();

      if (connection) {
        // Update existing
        await supabase
          .from("telegram_connections" as any)
          .update({
            bot_token: botToken.trim(),
            pairing_code: connection.is_paired ? null : pairingCode,
            is_active: true,
          })
          .eq("id", connection.id);
      } else {
        // Create new
        await supabase
          .from("telegram_connections" as any)
          .insert({
            user_id: user.id,
            bot_token: botToken.trim(),
            pairing_code: pairingCode,
          });
      }

      // Set webhook
      const { data: { session } } = await supabase.auth.getSession();
      const res = await supabase.functions.invoke("telegram-capture", {
        body: {},
        headers: {
          Authorization: `Bearer ${session?.access_token}`,
          "x-action": "set-webhook",
        },
      });

      // Reload connection
      const { data: updated } = await supabase
        .from("telegram_connections" as any)
        .select("*")
        .eq("user_id", user.id)
        .single();

      if (updated) {
        setConnection(updated as unknown as TelegramConnection);
      }

      showToast.success("Telegram bot connected! Webhook registered.");
    } catch (err: any) {
      showToast.error(err.message || "Failed to connect");
    } finally {
      setSaving(false);
    }
  };

  const handleSetWebhook = async () => {
    const { data: { session } } = await supabase.auth.getSession();

    // Use fetch directly with the action query param
    const res = await fetch(
      `https://${projectRef}.supabase.co/functions/v1/telegram-capture?action=set-webhook`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session?.access_token}`,
          "Content-Type": "application/json",
        },
        body: "{}",
      }
    );
    return res.json();
  };

  const handleConnect2 = async () => {
    if (!user || !botToken.trim()) return;
    setSaving(true);
    try {
      const pairingCode = generatePairingCode();

      if (connection) {
        await supabase
          .from("telegram_connections" as any)
          .update({
            bot_token: botToken.trim(),
            pairing_code: connection.is_paired ? null : pairingCode,
            is_active: true,
          })
          .eq("id", connection.id);
      } else {
        await supabase
          .from("telegram_connections" as any)
          .insert({
            user_id: user.id,
            bot_token: botToken.trim(),
            pairing_code: pairingCode,
          });
      }

      // Set webhook via direct fetch
      const webhookResult = await handleSetWebhook();

      // Reload connection
      const { data: updated } = await supabase
        .from("telegram_connections" as any)
        .select("*")
        .eq("user_id", user.id)
        .single();

      if (updated) {
        setConnection(updated as unknown as TelegramConnection);
      }

      if (webhookResult?.ok) {
        showToast.success("Telegram bot connected! Webhook registered.");
      } else {
        showToast.success("Connection saved. Webhook may need manual setup.");
      }
    } catch (err: any) {
      showToast.error(err.message || "Failed to connect");
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    if (!connection?.is_paired) {
      showToast.error("Pair your bot first by sending the code in Telegram");
      return;
    }
    setTesting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(
        `https://${projectRef}.supabase.co/functions/v1/telegram-capture?action=test`,
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
        showToast.success("Test message sent to Telegram!");
      } else {
        showToast.error(data.error || "Failed to send test message");
      }
    } catch {
      showToast.error("Failed to reach Telegram");
    } finally {
      setTesting(false);
    }
  };

  const handleDisconnect = async () => {
    if (!connection) return;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      await fetch(
        `https://${projectRef}.supabase.co/functions/v1/telegram-capture?action=delete-webhook`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session?.access_token}`,
            "Content-Type": "application/json",
          },
          body: "{}",
        }
      );

      await supabase
        .from("telegram_connections" as any)
        .update({ is_active: false, is_paired: false, telegram_chat_id: null, pairing_code: null })
        .eq("id", connection.id);

      setConnection({ ...connection, is_active: false, is_paired: false, telegram_chat_id: null, pairing_code: null });
      setBotToken("");
      showToast.success("Telegram disconnected");
    } catch {
      showToast.error("Failed to disconnect");
    }
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

  const isConnected = connection?.is_active && connection?.bot_token;
  const isPaired = connection?.is_paired;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#0088cc]">
              <Send className="h-5 w-5 text-white" />
            </div>
            <div>
              <CardTitle className="text-base">Telegram Capture</CardTitle>
              <CardDescription>Capture thoughts via Telegram bot</CardDescription>
            </div>
          </div>
          {isConnected && (
            <Badge
              variant="outline"
              className={
                isPaired
                  ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30"
                  : "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30"
              }
            >
              {isPaired ? (
                <><CheckCircle2 className="h-3 w-3 mr-1" /> Connected</>
              ) : (
                "Awaiting pairing"
              )}
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
                  Open Telegram and message{" "}
                  <a
                    href="https://t.me/BotFather"
                    target="_blank"
                    rel="noopener"
                    className="text-primary hover:underline inline-flex items-center gap-0.5"
                  >
                    @BotFather <ExternalLink className="h-3 w-3" />
                  </a>
                </li>
                <li>
                  Send <code className="bg-muted px-1.5 py-0.5 rounded text-xs">/newbot</code> and follow the prompts to name your bot
                </li>
                <li>Copy the <strong>bot token</strong> BotFather gives you and paste it below</li>
                <li>Click <strong>Connect</strong> — Menerio will automatically register the webhook</li>
                <li>
                  Open your new bot in Telegram and send the <strong>pairing code</strong> shown below
                </li>
                <li>You're all set! Send any message to capture it as a note</li>
              </ol>
            </AccordionContent>
          </AccordionItem>
        </Accordion>

        <Separator />

        {/* Bot token field */}
        <div className="space-y-1.5">
          <Label htmlFor="tg-token" className="text-xs">
            Bot Token
          </Label>
          <Input
            id="tg-token"
            type="password"
            value={botToken}
            onChange={(e) => setBotToken(e.target.value)}
            placeholder="123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11"
            className="font-mono text-sm"
          />
        </div>

        {/* Pairing code */}
        {isConnected && !isPaired && connection?.pairing_code && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 space-y-2">
            <p className="text-sm font-medium text-foreground">Pairing Code</p>
            <p className="text-xs text-muted-foreground">
              Send this code as a message to your Telegram bot to link it to your Menerio account:
            </p>
            <div className="flex items-center gap-2">
              <code className="text-2xl font-mono font-bold tracking-[0.3em] text-foreground bg-muted px-4 py-2 rounded-lg select-all">
                {connection.pairing_code}
              </code>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => {
                  navigator.clipboard.writeText(connection.pairing_code!);
                  showToast.copied();
                }}
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        {/* Connected status */}
        {isPaired && (
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4">
            <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5">
              <CheckCircle2 className="h-4 w-4" />
              Bot is paired and active
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Chat ID: <code className="bg-muted px-1 py-0.5 rounded text-xs">{connection?.telegram_chat_id}</code>
            </p>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-2">
          {!isConnected || !isPaired ? (
            <Button onClick={handleConnect2} disabled={saving || !botToken.trim()} size="sm">
              {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              {isConnected ? "Update" : "Connect"}
            </Button>
          ) : null}
          {isPaired && (
            <Button variant="outline" size="sm" onClick={handleTest} disabled={testing}>
              {testing && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Send Test Message
            </Button>
          )}
          {isConnected && (
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={handleDisconnect}
            >
              <Unplug className="h-3.5 w-3.5 mr-1" />
              Disconnect
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
