import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { ProfileCategory, AgentInstruction } from "@/hooks/useProfile";

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
      const [catRes, factRes, instrRes] = await Promise.all([
        supabase.from("profile_categories").select("id, slug, name, icon, visibility_scope").eq("user_id", userId!).is("contact_id", null),
        // The owner's current facts (history does not count towards completeness).
        supabase
          .from("profile_facts")
          .select("claim_id, category_slug")
          .eq("user_id", userId!)
          .eq("subject_type", "self")
          .eq("is_current", true),
        supabase.from("agent_instructions").select("id, is_active").eq("user_id", userId!),
      ]);
      // A failed read used to count as an empty profile and show 0% complete.
      const failed = catRes.error || factRes.error || instrRes.error;
      if (failed) throw failed;

      const categories = (catRes.data || []) as Pick<ProfileCategory, "id" | "slug" | "name" | "icon" | "visibility_scope">[];
      const facts = (factRes.data || []) as Array<{ claim_id: string | null; category_slug: string | null }>;
      const instructions = (instrRes.data || []) as Pick<AgentInstruction, "id" | "is_active">[];

      const filled = new Set(facts.map((f) => f.category_slug).filter(Boolean));
      const filledCount = categories.filter((c) => filled.has(c.slug)).length;
      const pct = categories.length > 0 ? Math.round((filledCount / categories.length) * 100) : 0;

      return {
        completeness: pct,
        entryCount: facts.length,
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
