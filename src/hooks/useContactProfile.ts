import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { showToast } from "@/lib/toast";
import type { ProfileCategory, ProfileEntry } from "./useProfile";

const DEFAULT_CATEGORIES = [
  { name: "Identity & Basics", slug: "identity", icon: "user", description: "Full name, pronouns, languages, nationality", sort_order: 0, visibility_scope: "all" },
  { name: "Location & Living", slug: "location", icon: "map-pin", description: "Current city, timezone, living situation", sort_order: 1, visibility_scope: "personal" },
  { name: "Professional Life", slug: "professional", icon: "briefcase", description: "Job, company, industry, skills", sort_order: 2, visibility_scope: "professional" },
  { name: "Relationships & Family", slug: "relationships", icon: "heart", description: "Close people, shared connections", sort_order: 3, visibility_scope: "personal" },
  { name: "Communication Style", slug: "communication", icon: "message-circle", description: "Tone, preferences, humor style", sort_order: 4, visibility_scope: "all" },
  { name: "Personality & Values", slug: "personality", icon: "compass", description: "Type indicators, core values", sort_order: 5, visibility_scope: "all" },
  { name: "Hobbies & Interests", slug: "hobbies", icon: "palette", description: "Active hobbies, creative pursuits", sort_order: 6, visibility_scope: "personal" },
  { name: "Food & Drink", slug: "food", icon: "utensils", description: "Cuisines, dietary style", sort_order: 7, visibility_scope: "personal" },
  { name: "Travel & Experiences", slug: "travel", icon: "plane", description: "Countries, travel style", sort_order: 8, visibility_scope: "personal" },
  { name: "Preferences & Quirks", slug: "preferences", icon: "sliders-horizontal", description: "Likes, dislikes, pet peeves", sort_order: 9, visibility_scope: "all" },
];

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
      const { data, error } = await supabase
        .from("profile_entries")
        .select("*")
        .eq("user_id", userId!)
        .eq("contact_id", contactId!)
        .order("sort_order");
      if (error) throw error;
      return data as ProfileEntry[];
    },
    enabled: !!userId && !!contactId,
  });

  const seedDefaults = useMutation({
    mutationFn: async () => {
      const rows = DEFAULT_CATEGORIES.map((c) => ({
        ...c,
        user_id: userId!,
        contact_id: contactId!,
        is_default: true,
      }));
      const { error } = await supabase.from("profile_categories").insert(rows);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["contact-profile-categories", userId, contactId] }),
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
    mutationFn: async (entry: Partial<ProfileEntry> & { id?: string }) => {
      if (entry.id) {
        const { error } = await supabase.from("profile_entries").update(entry).eq("id", entry.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("profile_entries").insert({
          ...entry,
          user_id: userId!,
          contact_id: contactId!,
        } as any);
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
    seedDefaults,
    upsertCategory,
    deleteCategory,
    upsertEntry,
    deleteEntry,
  };
}
