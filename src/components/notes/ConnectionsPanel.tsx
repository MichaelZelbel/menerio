import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Loader2,
  Link2,
  FileText,
  UserCircle,
  ListChecks,
  Sparkles,
  RefreshCw,
} from "lucide-react";

interface ConnectionResult {
  id: string;
  title: string;
  similarity: number;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

interface ConnectionsData {
  connections: ConnectionResult[];
  related_contacts: { id: string; name: string; relationship: string | null }[];
  related_actions: { id: string; content: string; status: string }[];
  insight: string | null;
}

/**
 * One find-connections call per note per calendar day.
 *
 * The effect below used to call the function on every mount, and the function
 * buys one chat completion per call, so every note open was a paid call
 * (spend audit, 2026-09-11). The result is now kept in localStorage under the
 * note id with the day it was fetched, the way TodaysConnections keeps the
 * daily widget. The Retry / Search again / Refresh buttons bypass the cache
 * and overwrite it. A failed call is never cached, so the Retry button keeps
 * its meaning.
 */
const CACHE_KEY_PREFIX = "menerio-note-connections:";

function cacheKey(noteId: string): string {
  return `${CACHE_KEY_PREFIX}${noteId}`;
}

function readCachedConnections(noteId: string): ConnectionsData | null {
  try {
    const raw = localStorage.getItem(cacheKey(noteId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { date?: string; data?: ConnectionsData };
    if (!parsed || parsed.date !== new Date().toDateString() || !parsed.data) return null;
    return parsed.data;
  } catch {
    return null; // malformed entry or storage unavailable: fetch as before
  }
}

function writeCachedConnections(noteId: string, data: ConnectionsData): void {
  try {
    localStorage.setItem(
      cacheKey(noteId),
      JSON.stringify({ date: new Date().toDateString(), data }),
    );
  } catch {
    // Storage full or blocked: the panel still shows the result, it just pays
    // again on the next open.
  }
}

export function ConnectionsPanel({ noteId }: { noteId: string }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState<ConnectionsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchConnections = async (opts: { force?: boolean } = {}) => {
    if (!user) return;

    if (!opts.force) {
      const cached = readCachedConnections(noteId);
      if (cached) {
        setData(cached);
        setError(null);
        return;
      }
    }

    setLoading(true);
    setError(null);

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    try {
      const res = await supabase.functions.invoke("find-connections", {
        body: { note_id: noteId },
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      if (res.error || res.data?.error) {
        setError(res.data?.error || "Failed to find connections");
      } else {
        setData(res.data);
        writeCachedConnections(noteId, res.data);
      }
    } catch {
      setError("Failed to find connections");
    } finally {
      setLoading(false);
    }
  };

  const refresh = () => fetchConnections({ force: true });

  useEffect(() => {
    fetchConnections();
  }, [noteId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-6 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin mr-2" />
        <span className="text-xs">Finding connections…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-4">
        <p className="text-xs text-muted-foreground mb-2">{error}</p>
        <Button variant="ghost" size="sm" onClick={refresh} className="text-xs gap-1">
          <RefreshCw className="h-3 w-3" /> Retry
        </Button>
      </div>
    );
  }

  if (!data || (data.connections.length === 0 && !data.insight)) {
    return (
      <div className="text-center py-4">
        <Link2 className="h-6 w-6 mx-auto mb-2 text-muted-foreground/30" />
        <p className="text-xs text-muted-foreground">No connections found yet.</p>
        <Button variant="ghost" size="sm" onClick={refresh} className="text-xs gap-1 mt-1">
          <RefreshCw className="h-3 w-3" /> Search again
        </Button>
      </div>
    );
  }

  return (
    <ScrollArea className="max-h-[400px]">
      <div className="space-y-4 p-1">
        {/* AI Insight */}
        {data.insight && (
          <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
            <div className="flex items-center gap-1.5 mb-1.5">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              <span className="text-xs font-semibold text-primary">AI Insight</span>
            </div>
            <p className="text-xs text-foreground leading-relaxed">{data.insight}</p>
          </div>
        )}

        {/* Related Notes */}
        {data.connections.length > 0 && (
          <div>
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <FileText className="h-3 w-3" /> Related Notes
            </h4>
            <div className="space-y-1">
              {data.connections.slice(0, 6).map((conn) => (
                <button
                  key={conn.id}
                  onClick={() => navigate(`/dashboard/notes/${conn.id}`)}
                  className="w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent transition-colors"
                >
                  <FileText className="h-3 w-3 text-muted-foreground shrink-0" />
                  <span className="text-xs truncate flex-1 text-foreground">{conn.title || "Untitled"}</span>
                  <Badge variant="outline" className="text-[9px] px-1.5 py-0 shrink-0">
                    {(conn.similarity * 100).toFixed(0)}%
                  </Badge>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Related People */}
        {data.related_contacts.length > 0 && (
          <>
            <Separator />
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <UserCircle className="h-3 w-3" /> Related People
              </h4>
              <div className="space-y-1">
                {data.related_contacts.map((contact) => (
                  <button
                    key={contact.id}
                    onClick={() => navigate("/dashboard/people")}
                    className="w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent transition-colors"
                  >
                    <UserCircle className="h-3 w-3 text-info shrink-0" />
                    <span className="text-xs text-foreground">{contact.name}</span>
                    {contact.relationship && (
                      <Badge variant="secondary" className="text-[9px] px-1.5 py-0">
                        {contact.relationship}
                      </Badge>
                    )}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {/* Related Actions */}
        {data.related_actions.length > 0 && (
          <>
            <Separator />
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <ListChecks className="h-3 w-3" /> Related Actions
              </h4>
              <div className="space-y-1">
                {data.related_actions.slice(0, 5).map((action) => (
                  <button
                    key={action.id}
                    onClick={() => navigate("/dashboard/actions")}
                    className="w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent transition-colors"
                  >
                    <ListChecks className="h-3 w-3 text-warning shrink-0" />
                    <span className="text-xs truncate flex-1 text-foreground">{action.content}</span>
                    <Badge
                      variant={action.status === "done" ? "secondary" : "outline"}
                      className="text-[9px] px-1.5 py-0"
                    >
                      {action.status}
                    </Badge>
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        <Button variant="ghost" size="sm" onClick={refresh} className="w-full text-xs gap-1">
          <RefreshCw className="h-3 w-3" /> Refresh connections
        </Button>
      </div>
    </ScrollArea>
  );
}
