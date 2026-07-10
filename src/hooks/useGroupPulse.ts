import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export type GroupPulseItem = {
  id: string;
  name: string;
  slug: string;
  icon: string | null;
  memberCount: number;
  staleCount: number;
  dueThisWeek: number;
  lastActivity: number;
};

export function useGroupPulse() {
  const { user } = useAuth();
  return useQuery<GroupPulseItem[]>({
    queryKey: ["group-pulse", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data: groups, error: groupError } = await supabase.from("contact_groups").select("id, name, slug, icon, updated_at").eq("user_id", user!.id).eq("is_trashed", false).is("archived_at", null);
      if (groupError) throw groupError;
      const groupIds = (groups || []).map((group) => group.id);
      if (groupIds.length === 0) return [];
      const weekEnd = new Date();
      weekEnd.setDate(weekEnd.getDate() + 7);
      const [{ data: memberships, error: membershipError }, { data: actions, error: actionError }] = await Promise.all([
        supabase.from("contact_group_memberships").select("group_id, last_movement_at").in("group_id", groupIds).is("archived_at", null),
        supabase.from("action_items").select("due_date, status, metadata").eq("user_id", user!.id).neq("status", "done").lte("due_date", weekEnd.toISOString().slice(0, 10)),
      ]);
      if (membershipError) throw membershipError;
      if (actionError) throw actionError;
      const staleCutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
      return (groups || []).map((group) => {
        const groupMemberships = (memberships || []).filter((membership) => membership.group_id === group.id);
        const groupActions = ((actions || []) as any[]).filter((action) => action.metadata?.group_id === group.id);
        const lastMovement = Math.max(new Date(group.updated_at).getTime(), ...groupMemberships.map((membership) => new Date(membership.last_movement_at).getTime()));
        return { id: group.id, name: group.name, slug: group.slug, icon: group.icon, memberCount: groupMemberships.length, staleCount: groupMemberships.filter((membership) => new Date(membership.last_movement_at).getTime() < staleCutoff).length, dueThisWeek: groupActions.length, lastActivity: lastMovement };
      }).sort((a, b) => b.lastActivity - a.lastActivity).slice(0, 3);
    },
  });
}
