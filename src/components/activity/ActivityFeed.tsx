import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Plus,
  Pencil,
  Trash2,
  LogIn,
  User,
  Shield,
  FolderOpen,
  ArrowRight,
  Activity,
} from "lucide-react";

const ACTION_ICONS: Record<string, React.ElementType> = {
  create: Plus,
  update: Pencil,
  delete: Trash2,
  login: LogIn,
  profile_update: User,
  role_change: Shield,
};

function formatAction(action: string, itemType: string, metadata?: any): string {
  const labels: Record<string, string> = {
    create: `Created a ${itemType}`,
    update: `Updated a ${itemType}`,
    delete: `Deleted a ${itemType}`,
    login: "Signed in",
    profile_update: "Updated profile",
    role_change: metadata?.new_role
      ? `Role changed to ${metadata.new_role}`
      : "Role changed",
  };
  return labels[action] || `${action} ${itemType}`;
}

function timeAgo(date: string): string {
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(date).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

interface ActivityFeedProps {
  limit?: number;
  showViewAll?: boolean;
}

export function ActivityFeed({ limit = 5, showViewAll = true }: ActivityFeedProps) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase
        .from("activity_events" as any)
        .select("*")
        .eq("actor_id", user.id)
        .order("created_at", { ascending: false })
        .limit(limit);
      setEvents(data || []);
      setLoading(false);
    })();
  }, [user, limit]);

  if (loading) {
    return (
      <Card>
        <CardHeader className="pb-3"><Skeleton className="h-5 w-32" /></CardHeader>
        <CardContent className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="h-8 w-8 rounded-full" />
              <div className="flex-1"><Skeleton className="h-3 w-3/4" /><Skeleton className="h-2 w-16 mt-1" /></div>
            </div>
          ))}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Activity className="h-4 w-4" /> Recent Activity
        </CardTitle>
        {showViewAll && (
          <Button variant="ghost" size="sm" className="gap-1 text-xs" onClick={() => navigate("/dashboard/activity")}>
            View All <ArrowRight className="h-3 w-3" />
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {events.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">No recent activity.</p>
        ) : (
          <ul className="space-y-3">
            {events.map((ev) => {
              const Icon = ACTION_ICONS[ev.action] || FolderOpen;
              return (
                <li key={ev.id} className="flex items-start gap-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted">
                    <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-foreground">{formatAction(ev.action, ev.item_type, ev.metadata)}</p>
                    <p className="text-[11px] text-muted-foreground">{timeAgo(ev.created_at)}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
