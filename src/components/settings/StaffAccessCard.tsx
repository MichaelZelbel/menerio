import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BRAND } from "@/lib/brand";

const LABELS: Record<string, string> = {
  moderation_review: "Our automatic check read a note you shared publicly",
  reanalyze_note: "An administrator re-ran the AI analysis on one of your notes",
  ensure_allowance: "An administrator set up your monthly AI credits",
  user_roles_insert: "An administrator set your plan",
  user_roles_update: "An administrator changed your plan",
  user_roles_delete: "An administrator removed your plan",
  ai_allowance_periods_insert: "An administrator set your AI credits",
  ai_allowance_periods_update: "An administrator changed your AI credits",
  ai_allowance_periods_delete: "An administrator removed your AI credits",
  user_suspensions_insert: "An administrator changed your account status",
  user_suspensions_update: "An administrator changed your account status",
  user_suspensions_delete: "An administrator changed your account status",
};

export function describeStaffAction(action: string): string {
  return LABELS[action] ?? "An administrator took an action on your account";
}

interface Entry { action: string; actor_kind: string; note_id: string | null; created_at: string }

export function StaffAccessCard() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["my-staff-access-log"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("my_staff_access_log");
      if (error) throw new Error(error.message);
      return (data ?? []) as Entry[];
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Staff access</CardTitle>
        <CardDescription>
          Every action {BRAND.name} staff take on your account, and every time our automatic check reads a note you shared publicly, is listed here.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? null : isError ? (
          <p className="text-sm text-muted-foreground">The staff access list could not be loaded. Please try again later.</p>
        ) : !data?.length ? (
          <p className="text-sm text-muted-foreground">Nobody at {BRAND.name} has taken any action on your account.</p>
        ) : (
          <ul className="space-y-2">
            {data.map((e, i) => (
              <li key={`${e.created_at}-${i}`} className="flex justify-between gap-4 text-sm">
                <span>{describeStaffAction(e.action)}</span>
                <span className="shrink-0 text-muted-foreground">{format(new Date(e.created_at), "MMM d, yyyy HH:mm")}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
