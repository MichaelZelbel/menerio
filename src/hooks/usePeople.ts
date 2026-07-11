import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { showToast } from "@/lib/toast";

export interface Person {
  id: string;
  user_id: string;
  name: string;
  notes: string | null;
  tags: string[];
  aliases: string[];
  app_mappings: Record<string, { display_name?: string }>;
  metadata: Record<string, unknown>;
  merged_into: string | null;
  is_favorite: boolean;
  last_viewed_at: string | null;
  created_at: string;
  updated_at: string;
}

// `is_sensitive` is selected (and used elsewhere via a cast) but not part of
// the formal Person shape yet — preserved as-is from the pre-extraction query.
const PEOPLE_COLUMNS =
  "id, user_id, name, notes, tags, aliases, app_mappings, metadata, merged_into, created_at, updated_at, is_sensitive, is_favorite, last_viewed_at";

const FIVE_MINUTES_MS = 5 * 60 * 1000;

/**
 * Pure throttle decision for useTouchPersonViewed: skip re-touching
 * last_viewed_at if the loaded row was already touched within 5 minutes.
 * An unparseable or missing timestamp always allows the touch through.
 */
export function shouldTouchViewed(lastViewedAt: string | null, now: Date): boolean {
  if (!lastViewedAt) return true;
  const lastMs = new Date(lastViewedAt).getTime();
  if (Number.isNaN(lastMs)) return true;
  return now.getTime() - lastMs >= FIVE_MINUTES_MS;
}

export function usePeople() {
  const { user } = useAuth();

  return useQuery<Person[]>({
    queryKey: ["contacts", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("contacts")
        .select(PEOPLE_COLUMNS)
        .eq("user_id", user!.id)
        .is("merged_into", null)
        .order("name");
      if (error) throw error;
      return ((data || []) as any[]).map((d) => ({
        ...d,
        aliases: d.aliases || [],
        app_mappings: d.app_mappings || {},
        is_favorite: d.is_favorite ?? false,
        last_viewed_at: d.last_viewed_at ?? null,
      })) as Person[];
    },
  });
}

export function useCreatePerson() {
  const qc = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (name: string) => {
      const { error } = await supabase.from("contacts").insert({
        user_id: user!.id,
        name: name.trim(),
        aliases: [],
        app_mappings: {},
      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contacts"] });
      showToast.success("Person added");
    },
    onError: (e: any) => showToast.error(e.message),
  });
}

export function useUpdatePerson() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      ...updates
    }: Partial<Pick<Person, "name" | "notes" | "aliases" | "app_mappings">> & { id: string }) => {
      const { error } = await supabase
        .from("contacts")
        .update(updates as any)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contacts"] });
    },
    onError: (e: any) => showToast.error(e.message),
  });
}

export function useDeletePerson() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("contacts").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contacts"] });
      showToast.success("Person removed");
    },
  });
}

export function useToggleFavoritePerson() {
  const qc = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({ id, isFavorite }: { id: string; isFavorite: boolean }) => {
      const { error } = await (supabase as any)
        .from("contacts")
        .update({ is_favorite: isFavorite })
        .eq("id", id);
      if (error) throw error;
      return { id, isFavorite };
    },
    onMutate: async ({ id, isFavorite }) => {
      const queryKey = ["contacts", user?.id];
      await qc.cancelQueries({ queryKey });
      const previous = qc.getQueryData<Person[]>(queryKey);
      qc.setQueryData<Person[]>(queryKey, (old) =>
        old?.map((person) => (person.id === id ? { ...person, is_favorite: isFavorite } : person)),
      );
      return { previous, queryKey };
    },
    onError: (e: any, _vars, context) => {
      if (context) qc.setQueryData(context.queryKey, context.previous);
      showToast.error(e.message ?? "Failed to update favorite");
    },
    onSettled: (_data, _err, _vars, context) => {
      qc.invalidateQueries({ queryKey: context?.queryKey ?? ["contacts", user?.id] });
    },
  });
}

export function useTouchPersonViewed() {
  const qc = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (id: string) => {
      const queryKey = ["contacts", user?.id];
      const people = qc.getQueryData<Person[]>(queryKey);
      const person = people?.find((p) => p.id === id);
      if (!shouldTouchViewed(person?.last_viewed_at ?? null, new Date())) {
        return null;
      }
      const lastViewedAt = new Date().toISOString();
      const { error } = await (supabase as any)
        .from("contacts")
        .update({ last_viewed_at: lastViewedAt })
        .eq("id", id);
      if (error) throw error;
      return { id, lastViewedAt };
    },
    onSuccess: (result) => {
      if (!result) return;
      const queryKey = ["contacts", user?.id];
      qc.setQueryData<Person[]>(queryKey, (old) =>
        old?.map((person) =>
          person.id === result.id ? { ...person, last_viewed_at: result.lastViewedAt } : person,
        ),
      );
    },
  });
}
