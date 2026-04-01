import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { ProfileCategory, ProfileEntry, AgentInstruction } from "@/hooks/useProfile";

/**
 * Lightweight hook that fetches only what's needed for profile completeness.
 * Used by Dashboard and Sidebar without pulling the full useProfile hook.
 */
export function useProfileSummary() {
  const { user } = useAuth();
  const userId = user?.id;

  const { data, isLoading } = useQuery({
    queryKey: ["profile-summary", userId],
    queryFn: async () => {
      const [catRes, entryRes, instrRes] = await Promise.all([
        supabase.from("profile_categories").select("id, slug, name, icon, visibility_scope").eq("user_id", userId!),
        supabase.from("profile_entries").select("id, category_id").eq("user_id", userId!),
        supabase.from("agent_instructions").select("id, is_active").eq("user_id", userId!),
      ]);

      const categories = (catRes.data || []) as Pick<ProfileCategory, "id" | "slug" | "name" | "icon" | "visibility_scope">[];
      const entries = (entryRes.data || []) as Pick<ProfileEntry, "id" | "category_id">[];
      const instructions = (instrRes.data || []) as Pick<AgentInstruction, "id" | "is_active">[];

      const filledCount = categories.filter((c) => entries.some((e) => e.category_id === c.id)).length;
      const pct = categories.length > 0 ? Math.round((filledCount / categories.length) * 100) : 0;

      return {
        completeness: pct,
        entryCount: entries.length,
        categoryCount: categories.length,
        activeInstructions: instructions.filter((i) => i.is_active).length,
      };
    },
    enabled: !!userId,
    staleTime: 60_000,
  });

  return {
    completeness: data?.completeness ?? 0,
    entryCount: data?.entryCount ?? 0,
    categoryCount: data?.categoryCount ?? 0,
    activeInstructions: data?.activeInstructions ?? 0,
    isLoading,
  };
}
