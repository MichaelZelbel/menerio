import { useState, useEffect } from "react";
import { Sparkles, Check, X, Loader2, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ProfileIcon } from "@/components/profile/ProfileIcon";
import { supabase } from "@/integrations/supabase/client";
import { showToast } from "@/lib/toast";
import type { ProfileCategory } from "@/hooks/useProfile";

interface Suggestion {
  category_slug: string;
  label: string;
  value: string;
  confidence: "high" | "medium" | "low";
  reason: string;
  source_note_id?: string;
}

interface ContactProfileSuggestionsProps {
  contactId: string;
  contactName: string;
  categories: ProfileCategory[];
  entryCount: number;
  noteCount: number;
  onAccept: (data: { category_id: string; label: string; value: string; linked_note_id: string | null; sort_order: number }) => void;
}

const COOLDOWN_MS = 24 * 60 * 60 * 1000;

function storageKey(contactId: string, type: "dismissed" | "last-run") {
  return `menerio-contact-profile-${type}-${contactId}`;
}

function getDismissed(contactId: string): string[] {
  try {
    return JSON.parse(localStorage.getItem(storageKey(contactId, "dismissed")) || "[]");
  } catch { return []; }
}

function dismissSuggestion(contactId: string, key: string) {
  const dismissed = getDismissed(contactId);
  dismissed.push(key);
  localStorage.setItem(storageKey(contactId, "dismissed"), JSON.stringify(dismissed));
}

function suggestionKey(s: Suggestion) {
  return `${s.category_slug}:${s.label}:${s.value}`;
}

const CONFIDENCE_COLORS: Record<string, string> = {
  high: "bg-green-500",
  medium: "bg-yellow-500",
  low: "bg-muted-foreground/50",
};

export function ContactProfileSuggestions({
  contactId,
  contactName,
  categories,
  entryCount,
  noteCount,
  onAccept,
}: ContactProfileSuggestionsProps) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [dismissed, setDismissed] = useState<string[]>(getDismissed(contactId));
  const [lastRun, setLastRun] = useState(() => {
    return parseInt(localStorage.getItem(storageKey(contactId, "last-run")) || "0", 10);
  });
  const [showNudge, setShowNudge] = useState(false);

  useEffect(() => {
    setDismissed(getDismissed(contactId));
    setLastRun(parseInt(localStorage.getItem(storageKey(contactId, "last-run")) || "0", 10));
    setSuggestions([]);
  }, [contactId]);

  useEffect(() => {
    if (entryCount < 3 && noteCount > 0 && suggestions.length === 0 && !loading) {
      setShowNudge(true);
    } else {
      setShowNudge(false);
    }
  }, [entryCount, noteCount, suggestions.length, loading]);

  const canRunAgain = Date.now() - lastRun > COOLDOWN_MS;
  const timeSinceRun = lastRun ? formatTimeAgo(lastRun) : null;

  async function runAnalysis() {
    if (!canRunAgain && suggestions.length > 0) {
      showToast.error(`Please wait — last analyzed ${timeSinceRun}`);
      return;
    }
    setLoading(true);
    setShowNudge(false);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      const resp = await supabase.functions.invoke("generate-contact-profile-suggestions", {
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: { contact_id: contactId },
      });

      if (resp.error) throw resp.error;
      const body = resp.data;
      if (body.error) throw new Error(body.error);

      const filtered = (body.suggestions || []).filter(
        (s: Suggestion) => !dismissed.includes(suggestionKey(s))
      );
      setSuggestions(filtered);
      const now = Date.now();
      localStorage.setItem(storageKey(contactId, "last-run"), String(now));
      setLastRun(now);

      if (filtered.length === 0) {
        showToast.info("No new suggestions found.");
      } else {
        showToast.success(`Found ${filtered.length} suggestion${filtered.length > 1 ? "s" : ""}`);
      }
    } catch (err: any) {
      console.error(err);
      showToast.error(err.message || "Failed to generate suggestions");
    } finally {
      setLoading(false);
    }
  }

  function handleAccept(s: Suggestion) {
    const cat = categories.find((c) => c.slug === s.category_slug);
    if (!cat) return;
    onAccept({
      category_id: cat.id,
      label: s.label,
      value: s.value,
      linked_note_id: s.source_note_id || null,
      sort_order: 0,
    });
    handleDismiss(s);
  }

  function handleDismiss(s: Suggestion) {
    const key = suggestionKey(s);
    dismissSuggestion(contactId, key);
    setDismissed((prev) => [...prev, key]);
    setSuggestions((prev) => prev.filter((x) => suggestionKey(x) !== key));
  }

  const visibleSuggestions = suggestions.filter((s) => !dismissed.includes(suggestionKey(s)));

  return (
    <div className="space-y-3">
      {showNudge && noteCount > 0 && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="p-4 flex items-center gap-3">
            <Sparkles className="h-5 w-5 text-primary shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">{noteCount} note{noteCount > 1 ? "s" : ""} mention {contactName}.</p>
              <p className="text-xs text-muted-foreground">Want me to suggest profile entries based on what you've written about them?</p>
            </div>
            <Button size="sm" onClick={runAnalysis} disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4 mr-1" />}
              Suggest
            </Button>
          </CardContent>
        </Card>
      )}

      {visibleSuggestions.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium flex items-center gap-1.5">
              <Sparkles className="h-4 w-4 text-primary" />
              AI Suggestions for {contactName}
            </h3>
            {timeSinceRun && (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Clock className="h-3 w-3" /> Last analyzed {timeSinceRun}
              </span>
            )}
          </div>
          {visibleSuggestions.map((s) => {
            const cat = categories.find((c) => c.slug === s.category_slug);
            return (
              <Card key={suggestionKey(s)} className="border-dashed">
                <CardContent className="p-3 flex items-start gap-3">
                  <div className="shrink-0 mt-0.5">
                    {cat && <ProfileIcon name={cat.icon || "folder"} className="h-4 w-4 text-muted-foreground" />}
                  </div>
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{s.label}</span>
                      <span className={`inline-block h-2 w-2 rounded-full ${CONFIDENCE_COLORS[s.confidence]}`} />
                      {cat && <Badge variant="outline" className="text-[10px] px-1.5 py-0">{cat.name}</Badge>}
                    </div>
                    <p className="text-sm text-foreground">{s.value}</p>
                    <p className="text-xs text-muted-foreground">{s.reason}</p>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => handleAccept(s)} title="Add to profile">
                      <Check className="h-3.5 w-3.5 text-green-600" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => handleDismiss(s)} title="Dismiss">
                      <X className="h-3.5 w-3.5 text-muted-foreground" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {!showNudge && visibleSuggestions.length === 0 && noteCount > 0 && (
        <Button
          variant="outline"
          className="w-full"
          onClick={runAnalysis}
          disabled={loading || (!canRunAgain && lastRun > 0)}
        >
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              Analyzing notes about {contactName}…
            </>
          ) : !canRunAgain && lastRun > 0 ? (
            <>
              <Clock className="h-4 w-4 mr-2" />
              Suggestions available again tomorrow
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4 mr-2" />
              Suggest entries from notes about {contactName}
            </>
          )}
        </Button>
      )}
    </div>
  );
}

function formatTimeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
