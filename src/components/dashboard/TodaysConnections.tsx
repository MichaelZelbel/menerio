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

    // Only fetch once per day
    const lastFetch = localStorage.getItem("menerio-daily-connections-date");
    const today = new Date().toDateString();
    if (lastFetch === today) {
      const cached = localStorage.getItem("menerio-daily-connections");
      if (cached) {
        try { setData(JSON.parse(cached)); } catch {}
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

      if (!res.error && res.data && res.data.connections?.length > 0) {
        setData(res.data);
        localStorage.setItem("menerio-daily-connections", JSON.stringify(res.data));
        localStorage.setItem("menerio-daily-connections-date", today);
      }
    } catch {}
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
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setDismissed(true)}>
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
            onClick={() => navigate(`/dashboard/notes?selected=${conn.id}`)}
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
