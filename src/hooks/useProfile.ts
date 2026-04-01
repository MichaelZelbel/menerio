import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { showToast } from "@/lib/toast";

export interface ProfileCategory {
  id: string;
  user_id: string;
  name: string;
  slug: string;
  icon: string | null;
  description: string | null;
  sort_order: number;
  is_default: boolean;
  visibility_scope: string;
  created_at: string;
  updated_at: string;
}

export interface ProfileEntry {
  id: string;
  user_id: string;
  category_id: string;
  label: string;
  value: string;
  linked_note_id: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface AgentInstruction {
  id: string;
  user_id: string;
  instruction: string;
  applies_to: string;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

const DEFAULT_CATEGORIES = [
  { name: "Identity & Basics", slug: "identity", icon: "user", description: "Full name, pronouns, languages, nationality", sort_order: 0, visibility_scope: "all" },
  { name: "Location & Living", slug: "location", icon: "map-pin", description: "Current city, timezone, living situation", sort_order: 1, visibility_scope: "personal" },
  { name: "Professional Life", slug: "professional", icon: "briefcase", description: "Job, company, industry, skills", sort_order: 2, visibility_scope: "professional" },
  { name: "Education", slug: "education", icon: "graduation-cap", description: "Degrees, certifications, learning style", sort_order: 3, visibility_scope: "professional" },
  { name: "Relationships & Family", slug: "relationships", icon: "heart", description: "Partner, children, close family", sort_order: 4, visibility_scope: "personal" },
  { name: "Communication Style", slug: "communication", icon: "message-circle", description: "Tone, pet peeves, humor style", sort_order: 5, visibility_scope: "all" },
  { name: "Personality & Values", slug: "personality", icon: "compass", description: "Type indicators, core values, philosophy", sort_order: 6, visibility_scope: "all" },
  { name: "Principles & Operating System", slug: "principles", icon: "book-open", description: "Personal rules, codex vitae, frameworks", sort_order: 7, visibility_scope: "all" },
  { name: "Health & Wellness", slug: "health", icon: "activity", description: "Medical, allergies, fitness, sleep", sort_order: 8, visibility_scope: "health" },
  { name: "Hobbies & Interests", slug: "hobbies", icon: "palette", description: "Active hobbies, creative pursuits", sort_order: 9, visibility_scope: "personal" },
  { name: "Food & Drink", slug: "food", icon: "utensils", description: "Cuisines, dietary style, cooking", sort_order: 10, visibility_scope: "personal" },
  { name: "Music & Entertainment", slug: "entertainment", icon: "music", description: "Genres, movies, books, gaming", sort_order: 11, visibility_scope: "personal" },
  { name: "Travel & Experiences", slug: "travel", icon: "plane", description: "Countries, bucket list, travel style", sort_order: 12, visibility_scope: "personal" },
  { name: "Digital Life", slug: "digital", icon: "monitor", description: "Social profiles, tools, tech stack", sort_order: 13, visibility_scope: "all" },
  { name: "Financial", slug: "financial", icon: "wallet", description: "Goals, investment style, budget", sort_order: 14, visibility_scope: "private" },
  { name: "Goals & Aspirations", slug: "goals", icon: "target", description: "Short-term, long-term, anti-goals", sort_order: 15, visibility_scope: "all" },
  { name: "Preferences & Quirks", slug: "preferences", icon: "sliders-horizontal", description: "Morning/night, introvert/extrovert, pet peeves", sort_order: 16, visibility_scope: "all" },
];

export function useProfile() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const userId = user?.id;

  const categoriesQuery = useQuery({
    queryKey: ["profile-categories", userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profile_categories")
        .select("*")
        .eq("user_id", userId!)
        .order("sort_order");
      if (error) throw error;
      return data as ProfileCategory[];
    },
    enabled: !!userId,
  });

  const entriesQuery = useQuery({
    queryKey: ["profile-entries", userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profile_entries")
        .select("*")
        .eq("user_id", userId!)
        .order("sort_order");
      if (error) throw error;
      return data as ProfileEntry[];
    },
    enabled: !!userId,
  });

  const instructionsQuery = useQuery({
    queryKey: ["agent-instructions", userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("agent_instructions")
        .select("*")
        .eq("user_id", userId!)
        .order("sort_order");
      if (error) throw error;
      return data as AgentInstruction[];
    },
    enabled: !!userId,
  });

  const seedDefaults = useMutation({
    mutationFn: async () => {
      const rows = DEFAULT_CATEGORIES.map((c) => ({
        ...c,
        user_id: userId!,
        is_default: true,
      }));
      const { error } = await supabase.from("profile_categories").insert(rows);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["profile-categories"] }),
  });

  const upsertCategory = useMutation({
    mutationFn: async (cat: Partial<ProfileCategory> & { id?: string }) => {
      if (cat.id) {
        const { error } = await supabase.from("profile_categories").update(cat).eq("id", cat.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("profile_categories").insert({ ...cat, user_id: userId! } as any);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["profile-categories"] });
      showToast.success("Category saved");
    },
  });

  const deleteCategory = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("profile_categories").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["profile-categories"] });
      qc.invalidateQueries({ queryKey: ["profile-entries"] });
      showToast.success("Category deleted");
    },
  });

  const upsertEntry = useMutation({
    mutationFn: async (entry: Partial<ProfileEntry> & { id?: string }) => {
      if (entry.id) {
        const { error } = await supabase.from("profile_entries").update(entry).eq("id", entry.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("profile_entries").insert({ ...entry, user_id: userId! } as any);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["profile-entries"] });
      showToast.success("Entry saved");
    },
  });

  const deleteEntry = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("profile_entries").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["profile-entries"] });
      showToast.success("Entry deleted");
    },
  });

  const upsertInstruction = useMutation({
    mutationFn: async (inst: Partial<AgentInstruction> & { id?: string }) => {
      if (inst.id) {
        const { error } = await supabase.from("agent_instructions").update(inst).eq("id", inst.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("agent_instructions").insert({ ...inst, user_id: userId! } as any);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["agent-instructions"] });
      showToast.success("Instruction saved");
    },
  });

  const deleteInstruction = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("agent_instructions").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["agent-instructions"] });
      showToast.success("Instruction deleted");
    },
  });

  return {
    categories: categoriesQuery.data ?? [],
    entries: entriesQuery.data ?? [],
    instructions: instructionsQuery.data ?? [],
    isLoading: categoriesQuery.isLoading || entriesQuery.isLoading,
    seedDefaults,
    upsertCategory,
    deleteCategory,
    upsertEntry,
    deleteEntry,
    upsertInstruction,
    deleteInstruction,
  };
}
