import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Bell, Loader2, Mail, RefreshCw } from "lucide-react";

interface Preferences {
  daily_digest_enabled: boolean;
  digest_time: string;
  notify_stale_actions: boolean;
  notify_contact_followup: boolean;
  notify_patterns: boolean;
  notify_weekly_review: boolean;
  digest_email: string;
}

const defaults: Preferences = {
  daily_digest_enabled: false,
  digest_time: "morning",
  notify_stale_actions: true,
  notify_contact_followup: true,
  notify_patterns: true,
  notify_weekly_review: true,
  digest_email: "",
};

export function NotificationPreferences() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [prefs, setPrefs] = useState<Preferences>(defaults);
  const [loading, setLoading] = useState(true);
  // A failed load left the defaults on screen, and Save then wrote them over
  // the real settings. While it is set, the form is not shown and cannot save.
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);

  // Keyed on the id, not the user object: a new object for the same account
  // (a token refresh on returning to the tab) must not reload the form over
  // unsaved changes.
  const userId = user?.id;
  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    // maybeSingle: no row yet is a new account on the defaults, not an error.
    const { data, error } = await supabase
      .from("notification_preferences")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) {
      setLoadFailed(true);
    } else {
      setLoadFailed(false);
      if (data) {
        setPrefs({
          daily_digest_enabled: data.daily_digest_enabled,
          digest_time: data.digest_time,
          notify_stale_actions: data.notify_stale_actions,
          notify_contact_followup: data.notify_contact_followup,
          notify_patterns: data.notify_patterns,
          notify_weekly_review: data.notify_weekly_review,
          digest_email: data.digest_email || "",
        });
      }
    }
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!user || loadFailed) return;
    setSaving(true);

    const payload = {
      user_id: user.id,
      ...prefs,
      digest_email: prefs.digest_email || null,
    };

    const { error } = await supabase
      .from("notification_preferences")
      .upsert(payload, { onConflict: "user_id" });

    if (error) {
      toast({ variant: "destructive", title: "Error", description: "Failed to save preferences." });
    } else {
      toast({ title: "Preferences saved" });
    }
    setSaving(false);
  };

  const update = <K extends keyof Preferences>(key: K, value: Preferences[K]) => {
    setPrefs((p) => ({ ...p, [key]: value }));
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (loadFailed) {
    return (
      <Card>
        <CardContent className="space-y-3 py-8 text-center">
          <p className="text-sm text-destructive" role="alert">
            Could not load your notification settings, so they cannot be changed right now.
          </p>
          <Button variant="outline" size="sm" onClick={() => void load()}>
            <RefreshCw className="mr-2 h-4 w-4" /> Try again
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bell className="h-5 w-5 text-primary" />
          Notifications
        </CardTitle>
        <CardDescription>Configure your daily digest and in-app notification preferences.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Daily Digest */}
        <div className="space-y-4">
          <h4 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Mail className="h-4 w-4 text-muted-foreground" />
            Daily Digest Email
          </h4>

          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="notif-daily-digest">Enable daily digest</Label>
              <p className="text-xs text-muted-foreground">Receive a summary email of your brain activity.</p>
            </div>
            <Switch
              id="notif-daily-digest"
              checked={prefs.daily_digest_enabled}
              onCheckedChange={(v) => update("daily_digest_enabled", v)}
            />
          </div>

          {prefs.daily_digest_enabled && (
            <div className="space-y-3 pl-1">
              <div className="space-y-1.5">
                <Label htmlFor="notif-digest-time">Preferred time</Label>
                <Select value={prefs.digest_time} onValueChange={(v) => update("digest_time", v)}>
                  <SelectTrigger id="notif-digest-time" className="w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="morning">Morning (8 AM)</SelectItem>
                    <SelectItem value="evening">Evening (6 PM)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="notif-digest-email">Digest email (optional)</Label>
                <Input
                  id="notif-digest-email"
                  type="email"
                  value={prefs.digest_email}
                  onChange={(e) => update("digest_email", e.target.value)}
                  placeholder={user?.email || "your@email.com"}
                  className="max-w-xs"
                />
                <p className="text-xs text-muted-foreground">Leave blank to use your account email.</p>
              </div>
            </div>
          )}
        </div>

        <Separator />

        {/* In-App Notifications */}
        <div className="space-y-4">
          <h4 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Bell className="h-4 w-4 text-muted-foreground" />
            In-App Notifications
          </h4>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="notif-stale-actions">Stale action items</Label>
                <p className="text-xs text-muted-foreground">Alert when action items have no updates for 14+ days.</p>
              </div>
              <Switch
                id="notif-stale-actions"
                checked={prefs.notify_stale_actions}
                onCheckedChange={(v) => update("notify_stale_actions", v)}
              />
            </div>

            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="notif-contact-followup">Contact follow-ups</Label>
                <p className="text-xs text-muted-foreground">Remind when contacts are overdue for check-in.</p>
              </div>
              <Switch
                id="notif-contact-followup"
                checked={prefs.notify_contact_followup}
                onCheckedChange={(v) => update("notify_contact_followup", v)}
              />
            </div>

            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="notif-patterns">Pattern detection</Label>
                <p className="text-xs text-muted-foreground">Notify when AI detects recurring themes.</p>
              </div>
              <Switch
                id="notif-patterns"
                checked={prefs.notify_patterns}
                onCheckedChange={(v) => update("notify_patterns", v)}
              />
            </div>

            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="notif-weekly-review">Weekly review reminder</Label>
                <p className="text-xs text-muted-foreground">Remind every Friday to generate your weekly review.</p>
              </div>
              <Switch
                id="notif-weekly-review"
                checked={prefs.notify_weekly_review}
                onCheckedChange={(v) => update("notify_weekly_review", v)}
              />
            </div>
          </div>
        </div>

        <Button onClick={save} disabled={saving || loadFailed}>
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Save Preferences
        </Button>
      </CardContent>
    </Card>
  );
}
