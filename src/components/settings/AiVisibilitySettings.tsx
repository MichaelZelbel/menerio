import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Loader2, EyeOff } from "lucide-react";
import { showToast } from "@/lib/toast";

/**
 * Settings panel for the global "Visible to AI" model.
 *
 * Currently exposes:
 *  - `hide_sensitive_from_ai` — when a person is marked sensitive,
 *    automatically hide all linked notes/moments/action_items from AI
 *    features (Lexicon, People, Knowledge Graph, AI Chat, MCP).
 */
export function AiVisibilitySettings() {
  const { user } = useAuth();
  const [hideSensitive, setHideSensitive] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await (supabase as any)
        .from("mcp_preferences")
        .select("hide_sensitive_from_ai")
        .eq("user_id", user.id)
        .maybeSingle();
      if (data?.hide_sensitive_from_ai !== undefined && data?.hide_sensitive_from_ai !== null) {
        setHideSensitive(!!data.hide_sensitive_from_ai);
      }
      setLoading(false);
    })();
  }, [user]);

  const onToggle = async (next: boolean) => {
    if (!user) return;
    setHideSensitive(next);
    setSaving(true);
    const { error } = await (supabase as any)
      .from("mcp_preferences")
      .upsert(
        { user_id: user.id, hide_sensitive_from_ai: next },
        { onConflict: "user_id" },
      );
    setSaving(false);
    if (error) {
      setHideSensitive(!next);
      showToast.error("Failed to update preference");
    } else {
      showToast.success("Preference saved");
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <EyeOff className="h-4 w-4 text-muted-foreground" /> AI Visibility
        </CardTitle>
        <CardDescription>
          Control which of your data the AI is allowed to see. Hidden items are
          excluded from Lexicon ingestion, People profile enrichment, the
          Knowledge Graph, AI Chat, and MCP clients. Your local search still
          finds them.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading preferences…
          </div>
        ) : (
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <Label htmlFor="hide-sensitive" className="text-sm font-medium">
                Auto-hide content linked to sensitive people
              </Label>
              <p className="text-xs text-muted-foreground max-w-md">
                When a person is marked as <em>sensitive</em>, all notes,
                moments and action items that mention them are automatically
                treated as hidden from AI — no per-item toggle needed.
              </p>
            </div>
            <Switch
              id="hide-sensitive"
              checked={hideSensitive}
              onCheckedChange={onToggle}
              disabled={saving}
            />
          </div>
        )}

        <div className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground space-y-1">
          <p className="font-medium text-foreground">How per-item visibility works</p>
          <p>
            Use the <span className="font-mono">AI / Hidden</span> button on
            any note, person, moment or collection item to toggle visibility.
            When you hide a note for the first time, a footprint dialog opens
            so you can clean up Lexicon contributions, profile entries, and
            graph edges that were derived earlier.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
