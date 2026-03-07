import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Plus,
  Pencil,
  Trash2,
  LogIn,
  User,
  Shield,
  FolderOpen,
  Activity,
  Search,
  X,
  Calendar,
} from "lucide-react";

const ACTION_ICONS: Record<string, React.ElementType> = {
  create: Plus,
  update: Pencil,
  delete: Trash2,
  login: LogIn,
  profile_update: User,
  role_change: Shield,
};

const ACTION_OPTIONS = [
  { value: "all", label: "All Actions" },
  { value: "create", label: "Create" },
  { value: "update", label: "Update" },
  { value: "delete", label: "Delete" },
  { value: "login", label: "Login" },
  { value: "profile_update", label: "Profile Update" },
  { value: "role_change", label: "Role Change" },
];

function formatAction(action: string, itemType: string, metadata?: any): string {
  const labels: Record<string, string> = {
    create: `Created a ${itemType}`,
    update: `Updated a ${itemType}`,
    delete: `Deleted a ${itemType}`,
    login: "Signed in",
    profile_update: "Updated profile",
    role_change: metadata?.new_role ? `Role changed to ${metadata.new_role}` : "Role changed",
  };
  return labels[action] || `${action} ${itemType}`;
}

const PAGE_SIZE = 20;

export default function ActivityPage() {
  const { user, role } = useAuth();
  const isAdmin = role === "admin";

  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [actionFilter, setActionFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const fetchEvents = useCallback(async (append = false) => {
    if (!user) return;
    append ? setLoadingMore(true) : setLoading(true);

    let query = supabase
      .from("activity_events" as any)
      .select("*")
      .order("created_at", { ascending: false });

    if (!isAdmin) {
      query = query.eq("actor_id", user.id);
    }
    if (actionFilter !== "all") {
      query = query.eq("action", actionFilter);
    }
    if (dateFrom) {
      query = query.gte("created_at", new Date(dateFrom).toISOString());
    }
    if (dateTo) {
      const end = new Date(dateTo);
      end.setDate(end.getDate() + 1);
      query = query.lt("created_at", end.toISOString());
    }

    const offset = append ? events.length : 0;
    query = query.range(offset, offset + PAGE_SIZE - 1);

    const { data } = await query;
    const newData = data || [];
    setHasMore(newData.length === PAGE_SIZE);

    if (append) {
      setEvents((prev) => [...prev, ...newData]);
    } else {
      setEvents(newData);
    }
    setLoading(false);
    setLoadingMore(false);
  }, [user, isAdmin, actionFilter, dateFrom, dateTo, events.length]);

  useEffect(() => {
    fetchEvents(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, actionFilter, dateFrom, dateTo]);

  const clearFilters = () => {
    setActionFilter("all");
    setDateFrom("");
    setDateTo("");
  };

  const hasFilters = actionFilter !== "all" || dateFrom || dateTo;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-display font-bold flex items-center gap-2">
          <Activity className="h-6 w-6" /> Activity Log
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {isAdmin ? "All user activity across the platform." : "Your recent actions and events."}
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Select value={actionFilter} onValueChange={setActionFilter}>
          <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            {ACTION_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-muted-foreground shrink-0" />
          <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-[140px] h-9" />
          <span className="text-xs text-muted-foreground">to</span>
          <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-[140px] h-9" />
        </div>

        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters} className="text-muted-foreground gap-1">
            <X className="h-3 w-3" /> Clear
          </Button>
        )}
      </div>

      {/* Events list */}
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 p-3 rounded-lg border">
              <Skeleton className="h-9 w-9 rounded-full" />
              <div className="flex-1"><Skeleton className="h-4 w-2/3" /><Skeleton className="h-3 w-24 mt-1" /></div>
            </div>
          ))}
        </div>
      ) : events.length === 0 ? (
        <div className="text-center py-16">
          <Activity className="h-10 w-10 mx-auto text-muted-foreground/40 mb-4" />
          <h3 className="text-lg font-semibold font-display mb-1">No activity yet</h3>
          <p className="text-sm text-muted-foreground">
            {hasFilters ? "Try adjusting your filters." : "Activity will appear here as you use the app."}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {events.map((ev) => {
            const Icon = ACTION_ICONS[ev.action] || FolderOpen;
            return (
              <div key={ev.id} className="flex items-start gap-3 rounded-lg border bg-card p-3 transition-colors hover:bg-accent/50">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted">
                  <Icon className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-foreground">{formatAction(ev.action, ev.item_type, ev.metadata)}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <p className="text-[11px] text-muted-foreground">
                      {new Date(ev.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </p>
                    {ev.item_type && (
                      <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{ev.item_type}</span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Load more */}
      {hasMore && !loading && events.length > 0 && (
        <div className="flex justify-center pt-2">
          <Button variant="outline" onClick={() => fetchEvents(true)} disabled={loadingMore}>
            {loadingMore ? "Loading…" : "Load More"}
          </Button>
        </div>
      )}
    </div>
  );
}
