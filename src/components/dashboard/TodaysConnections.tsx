import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sparkles, X, Check, Loader2, Link2 } from "lucide-react";

interface DailyConnection {
  connections: { id: string; title: string; similarity: number; created_at: string }[];
  insight: string | null;
  source_note: { id: string; title: string } | null;
}

export function TodaysConnections() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState<DailyConnection | null>(null);
  const [loading, setLoading] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const fetch = useCallback(async () => {
    if (!user) return;

    // Only fetch once per day. The cache is per account: a shared key showed
    // the previous account's note titles to whoever signed in next that day.
    const dateKey = `menerio-daily-connections-date:${user.id}`;
    const dataKey = `menerio-daily-connections:${user.id}`;
    const lastFetch = localStorage.getItem(dateKey);
    const today = new Date().toDateString();
    if (lastFetch === today) {
      const cached = localStorage.getItem(dataKey);
      if (cached) {
        try { setData(JSON.parse(cached)); } catch { /* ignore malformed cache */ }
        return;
      }
    }

    setLoading(true);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { setLoading(false); return; }

    try {
      const res = await supabase.functions.invoke("find-connections", {
        body: { mode: "daily" },
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      // Silently skip on insufficient-credits or any error — widget is optional
      if (res.error) {
        // Cache today's date so we don't retry on every dashboard mount
        localStorage.setItem(dateKey, today);
        localStorage.removeItem(dataKey);
      } else if (res.data) {
        // An empty answer is cached for the day too. It used to be left
        // uncached, so an account with no match (or whose newest note had no
        // embedding yet, which the function then embeds and pays for without
        // saving) called find-connections again on every Dashboard visit.
        const hasConnections = res.data.connections?.length > 0;
        if (hasConnections) setData(res.data);
        localStorage.setItem(dataKey, JSON.stringify(hasConnections ? res.data : null));
        localStorage.setItem(dateKey, today);
      }
    } catch { /* network errors are non-fatal */ }
    setLoading(false);
  }, [user]);

  useEffect(() => { fetch(); }, [fetch]);

  if (dismissed || (!loading && !data)) return null;

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin mr-2" />
          <span className="text-sm">Finding today's connections…</span>
        </CardContent>
      </Card>
    );
  }

  if (!data || !data.insight) return null;

  return (
    <Card className="border-primary/20">
      <CardHeader className="flex flex-row items-start justify-between pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Link2 className="h-4 w-4 text-primary" />
          Today's Connections
        </CardTitle>
        <Button aria-label="Dismiss" variant="ghost" size="icon" className="h-6 w-6" onClick={() => setDismissed(true)}>
          <X className="h-3.5 w-3.5" />
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="rounded-lg bg-primary/5 border border-primary/10 p-3">
          <div className="flex items-center gap-1.5 mb-1">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            <span className="text-xs font-medium text-primary">AI Insight</span>
          </div>
          <p className="text-xs text-foreground leading-relaxed">{data.insight}</p>
        </div>

        {data.connections.slice(0, 3).map((conn) => (
          <button
            key={conn.id}
            onClick={() => navigate(`/dashboard/notes/${conn.id}`)}
            className="w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent transition-colors"
          >
            <span className="text-xs truncate flex-1 text-foreground">{conn.title}</span>
            <Badge variant="outline" className="text-[9px] px-1.5 py-0 shrink-0">
              {(conn.similarity * 100).toFixed(0)}%
            </Badge>
          </button>
        ))}
      </CardContent>
    </Card>
  );
}
