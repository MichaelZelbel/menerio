import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { showToast } from "@/lib/toast";
import { usePeopleSync } from "@/hooks/usePeopleSync";

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

/**
 * Full touch decision including the loaded-row gate: a row that isn't in the
 * cache yet is NOT "never viewed" — on a fresh page load the contacts query
 * hasn't resolved, and touching blind would bypass the 5-minute throttle on
 * every reload. Only a genuinely loaded row may be touched.
 */
export function shouldTouchLoadedPerson(
  person: { last_viewed_at?: string | null } | undefined,
  now: Date,
): boolean {
  if (!person) return false;
  return shouldTouchViewed(person.last_viewed_at ?? null, now);
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
  const { triggerPeopleSync } = usePeopleSync();

  return useMutation({
    mutationFn: async (name: string) => {
      // Returns the created row so callers (e.g. "Add person here" in the group
      // tree) can chain a membership insert on the new id.
      const { data, error } = await (supabase as any)
        .from("contacts")
        .insert({
          user_id: user!.id,
          name: name.trim(),
          aliases: [],
          app_mappings: {},
        })
        .select()
        .single();
      if (error) throw error;
      return data as Person;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contacts"] });
      triggerPeopleSync();
      showToast.success("Person added");
    },
    onError: (e: any) => showToast.error(e.message),
  });
}

export function useUpdatePerson() {
  const qc = useQueryClient();
  const { triggerPeopleSync } = usePeopleSync();

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
      triggerPeopleSync();
    },
    onError: (e: any) => showToast.error(e.message),
  });
}

export function useDeletePerson() {
  const qc = useQueryClient();
  const { triggerPeopleSync, deleteEntityFile } = usePeopleSync();

  return useMutation({
    mutationFn: async (id: string) => {
      // Remove the mirrored vault file first — the sync log still knows its
      // path. Best-effort; the sweep's retire pass is the backstop.
      const affectedGroupIds = await deleteEntityFile("person", id);
      const { error } = await supabase.from("contacts").delete().eq("id", id);
      if (error) throw error;
      return affectedGroupIds;
    },
    onSuccess: (affectedGroupIds) => {
      qc.invalidateQueries({ queryKey: ["contacts"] });
      // Member tables of the person's former groups need a refresh now that
      // the memberships cascaded away.
      triggerPeopleSync({ groups: affectedGroupIds });
      // The DB cascades this person's contact_group_memberships rows, but
      // the aggregate membership query that powers the People tree's group
      // counts never hears about it on its own — with a 5-minute staleTime,
      // no focus refetch, and a 24h persister, stale counts would otherwise
      // linger for the rest of the session.
      qc.invalidateQueries({ queryKey: ["contact_group_memberships"] });
      showToast.success("Person removed");
    },
  });
}

export function useToggleFavoritePerson() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { triggerPeopleSync } = usePeopleSync();

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
    onSuccess: () => triggerPeopleSync(),
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
      if (!shouldTouchLoadedPerson(person, new Date())) {
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
