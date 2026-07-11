import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { showToast } from "@/lib/toast";
import type { ProfileCategory, ProfileEntry } from "./useProfile";

/**
 * A contact profile entry, including `is_pinned` (added by the
 * `people_ux_foundations` migration). The generated `src/integrations/
 * supabase/types.ts` hasn't been regenerated to include this column, so
 * queries/mutations below cast the client to `any` for it — same pattern
 * `usePeople.ts` uses for `is_favorite`/`last_viewed_at`.
 */
export interface ContactProfileEntry extends ProfileEntry {
  is_pinned: boolean;
}

export function useContactProfile(contactId: string | null) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const userId = user?.id;

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

  const entriesQuery = useQuery({
    queryKey: ["contact-profile-entries", userId, contactId],
    queryFn: async () => {
      // Cast to `any`: `is_pinned` (added by the people_ux_foundations
      // migration) isn't in the generated types.ts yet — same pattern as
      // usePeople.ts's is_favorite/last_viewed_at.
      const { data, error } = await (supabase as any)
        .from("profile_entries")
        .select("*")
        .eq("user_id", userId!)
        .eq("contact_id", contactId!)
        .order("sort_order");
      if (error) throw error;
      return ((data ?? []) as any[]).map((d) => ({
        ...d,
        is_pinned: d.is_pinned ?? false,
      })) as ContactProfileEntry[];
    },
    enabled: !!userId && !!contactId,
  });

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
      qc.invalidateQueries({ queryKey: ["contact-profile-categories", userId, contactId] });
      showToast.success("Category saved");
    },
  });

  const deleteCategory = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("profile_categories").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contact-profile-categories", userId, contactId] });
      qc.invalidateQueries({ queryKey: ["contact-profile-entries", userId, contactId] });
      showToast.success("Category deleted");
    },
  });

  const upsertEntry = useMutation({
    mutationFn: async (entry: Partial<ContactProfileEntry> & { id?: string }) => {
      // Cast to `any`: see the entriesQuery comment above re: is_pinned.
      if (entry.id) {
        const { error } = await (supabase as any).from("profile_entries").update(entry).eq("id", entry.id);
        if (error) throw error;
      } else {
        const { error } = await (supabase as any).from("profile_entries").insert({
          ...entry,
          user_id: userId!,
          contact_id: contactId!,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contact-profile-entries", userId, contactId] });
      showToast.success("Entry saved");
    },
  });

  const deleteEntry = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("profile_entries").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contact-profile-entries", userId, contactId] });
      showToast.success("Entry deleted");
    },
  });

  return {
    categories: categoriesQuery.data ?? [],
    entries: entriesQuery.data ?? [],
    isLoading: categoriesQuery.isLoading || entriesQuery.isLoading,
    upsertCategory,
    deleteCategory,
    upsertEntry,
    deleteEntry,
  };
}
