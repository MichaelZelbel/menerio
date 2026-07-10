import { useNavigate } from "react-router-dom";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Users2, ArrowRight } from "lucide-react";
import { useGroupPulse } from "@/hooks/useGroupPulse";

export function GroupPulseCard() {
  const navigate = useNavigate();
  const { data: groupPulse = [] } = useGroupPulse();

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-base">Group Pulse</CardTitle>
        <Users2 className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent className="space-y-2">
        {groupPulse.length === 0 ? (
          <button onClick={() => navigate("/dashboard/groups")} className="w-full rounded-md px-2 py-3 text-left text-sm text-muted-foreground transition-colors hover:bg-accent">
            No active groups yet — start one from the Groups page.
          </button>
        ) : groupPulse.map((group) => (
          <button key={group.id} onClick={() => navigate(`/dashboard/groups/${group.slug}`)} className="w-full rounded-md px-2 py-2 text-left transition-colors hover:bg-accent">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-xs text-primary">{group.icon || <Users2 className="h-3.5 w-3.5" />}</span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{group.name}</span>
              <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground" />
            </div>
            <p className="mt-1 pl-9 text-xs text-muted-foreground">{group.memberCount} members · {group.staleCount} stale members · {group.dueThisWeek} action items due this week</p>
          </button>
        ))}
      </CardContent>
    </Card>
  );
}
