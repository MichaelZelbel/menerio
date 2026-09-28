import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { deleteProfileSection } from "@/lib/profile-section-delete";
import { useAuth } from "@/contexts/AuthContext";
import { showToast } from "@/lib/toast";
import { usePeopleSync } from "@/hooks/usePeopleSync";
import type { ProfileCategory } from "./useProfile";

/**
 * A person's sections (`profile_categories` rows with their privacy scope).
 * Their facts are read and written through `useFacts({ type: "contact", id })`
 * (docs/plans/one-fact-store.md, 3.7); this hook only manages the sections.
 */
export function useContactProfile(contactId: string | null) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const userId = user?.id;
  const { triggerPeopleSync } = usePeopleSync();

  const categoriesQuery = useQuery({
    queryKey: ["contact-profile-categories", userId, contactId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profile_categories")
        .select("*")
        .eq("user_id", userId!)
        .eq("contact_id", contactId!)
        .order("sort_order");
      if (error) throw error;
      return data as ProfileCategory[];
    },
    enabled: !!userId && !!contactId,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["contact-profile-categories", userId, contactId] });
    // A section's name and privacy scope reach the facts through the view.
    qc.invalidateQueries({ queryKey: ["profile-facts"] });
  };

  // Every mutation reports its own failure: the pages call plain mutate().
  const upsertCategory = useMutation({
    mutationFn: async (cat: Partial<ProfileCategory> & { id?: string }) => {
      if (cat.id) {
        const { error } = await supabase.from("profile_categories").update(cat).eq("id", cat.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("profile_categories").insert({
          ...cat,
          user_id: userId!,
          contact_id: contactId!,
        } as any);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      invalidate();
      triggerPeopleSync();
      showToast.success("Category saved");
    },
    onError: (error: Error) => showToast.error(error?.message || "Could not save the category"),
  });

  const deleteCategory = useMutation({
    mutationFn: async (id: string) => {
      await deleteProfileSection(supabase, id);
    },
    onSuccess: () => {
      invalidate();
      // Hard delete: no updated_at trace, so force the page.
      triggerPeopleSync(contactId ? { people: [contactId] } : undefined);
      showToast.success("Category deleted");
    },
    onError: (error: Error) => showToast.error(error?.message || "Could not delete the category"),
  });

  return {
    categories: categoriesQuery.data ?? [],
    isLoading: categoriesQuery.isLoading,
    upsertCategory,
    deleteCategory,
  };
}
