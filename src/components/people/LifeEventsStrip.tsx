import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { format } from "date-fns";
import { Calendar } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Badge } from "@/components/ui/badge";

interface LifeEventsStripProps {
  contactId: string;
}

type MomentRow = {
  id: string;
  title: string;
  happened_at: string;
  status: string;
  category: string | null;
};

/**
 * Compact read-only "Life events from Timeline" strip surfacing the most
 * recent moments where this contact is a participant. Hidden entirely when
 * the person has no timeline activity.
 */
export function LifeEventsStrip({ contactId }: LifeEventsStripProps) {
  const { user } = useAuth();

  const { data: moments = [] } = useQuery({
    queryKey: ["life-events-strip", user?.id, contactId],
    enabled: !!user?.id && !!contactId,
    queryFn: async () => {
      const { data: participantRows } = await supabase
        .from("moment_participants" as any)
        .select("moment_id")
        .eq("person_id", contactId);
      const ids = (participantRows || []).map((r: any) => r.moment_id);
      if (ids.length === 0) return [] as MomentRow[];
      const { data } = await supabase
        .from("moments" as any)
        .select("id, title, happened_at, status, category")
        .eq("user_id", user!.id)
        .is("deleted_at", null)
        .in("id", ids)
        .order("happened_at", { ascending: false })
        .limit(6);
      return (data || []) as unknown as MomentRow[];
    },
  });

  if (moments.length === 0) return null;

  return (
    <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <Calendar className="h-3.5 w-3.5" />
          Life events from Timeline
        </div>
        <Link
          to="/dashboard/timeline"
          className="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
        >
          View all
        </Link>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
        {moments.map((m) => (
          <Link
            key={m.id}
            to={`/dashboard/timeline?moment=${m.id}`}
            className="shrink-0 w-44 rounded-md border border-border bg-background p-2 hover:border-primary/40 transition-colors"
          >
            <div className="text-[10px] text-muted-foreground">
              {m.happened_at ? format(new Date(m.happened_at), "MMM d, yyyy") : ""}
            </div>
            <div className="text-xs font-medium line-clamp-2 mt-0.5">{m.title}</div>
            {m.category && (
              <Badge variant="outline" className="mt-1.5 text-[10px] font-normal">
                {m.category}
              </Badge>
            )}
          </Link>
        ))}
      </div>
    </div>
  );
}
