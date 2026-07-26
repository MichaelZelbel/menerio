import { useEffect, useState } from "react";
import { Brain, Loader2, Sparkles } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type SuggestionMode = "auto" | "ask" | "off";
type SuggestionSensitivity = "conservative" | "balanced" | "exploratory";

interface Preferences {
  suggestion_mode: SuggestionMode;
  suggestion_sensitivity: SuggestionSensitivity;
  auto_add_sensitive: boolean;
  profile_language: string;
}

// Languages the profile normaliser can standardise facts into.
const PROFILE_LANGUAGES = [
  "English", "German", "French", "Spanish", "Italian", "Portuguese", "Dutch",
  "Polish", "Swedish", "Danish", "Norwegian", "Finnish", "Czech", "Turkish",
  "Chinese", "Japanese", "Korean", "Russian", "Arabic", "Hindi",
];

const defaults: Preferences = {
  suggestion_mode: "auto",
  suggestion_sensitivity: "balanced",
  auto_add_sensitive: false,
  profile_language: "English",
};

const modeOptions: Array<{ value: SuggestionMode; label: string; description: string }> = [
  {
    value: "auto",
    label: "Add automatically",
    description: "Menerio adds high-confidence suggestions right away. You can review and remove them later.",
  },
  {
    value: "ask",
    label: "Ask before adding",
    description: "Suggestions wait for your approval before changing profiles, timelines, or other knowledge.",
  },
  {
    value: "off",
    label: "Off",
    description: "Menerio does not create AI suggestions from your notes.",
  },
];

const sensitivityOptions: Array<{ value: SuggestionSensitivity; label: string; description: string }> = [
  {
    value: "conservative",
    label: "Conservative",
    description: "Only add things Menerio is very sure about.",
  },
  {
    value: "balanced",
    label: "Balanced",
    description: "A good mix of useful additions and caution.",
  },
  {
    value: "exploratory",
    label: "Exploratory",
    description: "Add more possible insights. You may need to remove more.",
  },
];

export function AISuggestionPreferences() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [prefs, setPrefs] = useState<Preferences>(defaults);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) return;

    supabase
      .from("ai_suggestion_preferences" as any)
      .select("suggestion_mode, suggestion_sensitivity, auto_add_sensitive, profile_language")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        const row = data as any;
        if (row) {
          setPrefs({
            suggestion_mode: row.suggestion_mode || defaults.suggestion_mode,
            suggestion_sensitivity: row.suggestion_sensitivity || defaults.suggestion_sensitivity,
            auto_add_sensitive: row.auto_add_sensitive ?? defaults.auto_add_sensitive,
            profile_language: row.profile_language || defaults.profile_language,
          });
        }
        setLoading(false);
      });
  }, [user]);

  const save = async () => {
    if (!user) return;
    setSaving(true);

    const { error } = await supabase
      .from("ai_suggestion_preferences" as any)
      .upsert({ user_id: user.id, ...prefs } as any, { onConflict: "user_id" });

    if (error) {
      toast({ variant: "destructive", title: "Error", description: "Failed to save AI suggestion settings." });
    } else {
      toast({ title: "AI suggestion settings saved" });
    }
    setSaving(false);
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

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Brain className="h-5 w-5 text-primary" />
          AI Suggestions
        </CardTitle>
        <CardDescription>Choose how Menerio turns note insights into updates to your knowledge base.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-3">
          <div>
            <Label className="text-sm font-semibold">AI suggestion mode</Label>
          </div>
          <RadioGroup
            value={prefs.suggestion_mode}
            onValueChange={(value) => setPrefs((p) => ({ ...p, suggestion_mode: value as SuggestionMode }))}
            className="gap-3"
          >
            {modeOptions.map((option) => (
              <label key={option.value} className="flex cursor-pointer items-start gap-3 rounded-md border border-border p-3 transition-colors hover:bg-muted/50">
                <RadioGroupItem value={option.value} className="mt-1" />
                <span className="space-y-1">
                  <span className="block text-sm font-medium text-foreground">{option.label}</span>
                  <span className="block text-xs text-muted-foreground">{option.description}</span>
                </span>
              </label>
            ))}
          </RadioGroup>
        </div>

        <Separator />

        <div className="space-y-3">
          <div>
            <Label className="text-sm font-semibold">Suggestion sensitivity</Label>
          </div>
          <RadioGroup
            value={prefs.suggestion_sensitivity}
            onValueChange={(value) => setPrefs((p) => ({ ...p, suggestion_sensitivity: value as SuggestionSensitivity }))}
            className="gap-3"
          >
            {sensitivityOptions.map((option) => (
              <label key={option.value} className="flex cursor-pointer items-start gap-3 rounded-md border border-border p-3 transition-colors hover:bg-muted/50">
                <RadioGroupItem value={option.value} className="mt-1" />
                <span className="space-y-1">
                  <span className="block text-sm font-medium text-foreground">{option.label}</span>
                  <span className="block text-xs text-muted-foreground">{option.description}</span>
                </span>
              </label>
            ))}
          </RadioGroup>
        </div>

        <Separator />

        <div className="flex items-center justify-between gap-4">
          <div className="space-y-1">
            <Label className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-muted-foreground" />
              Auto-add sensitive insights
            </Label>
            <p className="text-xs text-muted-foreground">
              Keep off to review medical, legal, financial, romantic, or emotionally sensitive suggestions first.
            </p>
          </div>
          <Switch
            checked={prefs.auto_add_sensitive}
            onCheckedChange={(checked) => setPrefs((p) => ({ ...p, auto_add_sensitive: checked }))}
          />
        </div>

        <Separator />

        <div className="space-y-2">
          <Label className="text-sm font-semibold">Profile language</Label>
          <p className="text-xs text-muted-foreground">
            Standardised profile facts — job title, nationality, languages, city and country names — are written in
            this language, even when the note was written in another one. Names, addresses and quotes are never translated.
          </p>
          <Select
            value={prefs.profile_language}
            onValueChange={(value) => setPrefs((p) => ({ ...p, profile_language: value }))}
          >
            <SelectTrigger className="w-full sm:w-64"><SelectValue /></SelectTrigger>
            <SelectContent>
              {PROFILE_LANGUAGES.map((lang) => (
                <SelectItem key={lang} value={lang}>{lang}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Button onClick={save} disabled={saving}>
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Save Settings
        </Button>
      </CardContent>
    </Card>
  );
}
