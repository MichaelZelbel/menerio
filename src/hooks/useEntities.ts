import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { showToast } from "@/lib/toast";
import { ilikeContains } from "@/lib/postgrest";

/**
 * Non-person things in a user's life: places, organizations, projects,
 * objects, pets. People stay in `contacts` — this never replaces them.
 * `entity_type` is open vocabulary: the suggestions below are a starting
 * point for the combobox, never a closed list, and the filter chips in the
 * UI are derived from the types that actually exist in the user's data.
 */
export const ENTITY_TYPE_SUGGESTIONS = ["place", "organization", "project", "thing", "pet", "other"];

export interface Entity {
  id: string;
  user_id: string;
  name: string;
  aliases: string[];
  entity_type: string;
  description: string | null;
  tags: string[];
  metadata: Record<string, unknown>;
  ai_visibility: string;
  is_sensitive: boolean;
  created_at: string;
  updated_at: string;
}

const db = supabase as any;

export function useEntities() {
  const { user } = useAuth();

  return useQuery<Entity[]>({
    queryKey: ["entities", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await db
        .from("entities")
        .select("*")
        .eq("user_id", user!.id)
        .order("name");
      if (error) throw error;
      return ((data || []) as any[]).map((e) => ({
        ...e,
        aliases: e.aliases || [],
        tags: e.tags || [],
        metadata: e.metadata || {},
      })) as Entity[];
    },
  });
}

export function useEntity(id: string | null) {
  const { data: entities = [] } = useEntities();
  return entities.find((e) => e.id === id) ?? null;
}

export type EntityInput = {
  name: string;
  entity_type: string;
  aliases?: string[];
  description?: string | null;
  tags?: string[];
};

export function useCreateEntity() {
  const qc = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (input: EntityInput) => {
      const { data, error } = await db
        .from("entities")
        .insert({
          user_id: user!.id,
          name: input.name.trim(),
          entity_type: (input.entity_type || "other").trim().toLowerCase(),
          aliases: input.aliases || [],
          description: input.description || null,
          tags: input.tags || [],
        })
        .select("*")
        .single();
      if (error) throw error;
      return data as Entity;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["entities"] });
      showToast.success("Added");
    },
    onError: (e: any) => showToast.error(e.message ?? "Could not add it"),
  });
}

export function useUpdateEntity() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<EntityInput> & { id: string }) => {
      const payload: Record<string, unknown> = { ...updates };
      if (typeof payload.name === "string") payload.name = (payload.name as string).trim();
      if (typeof payload.entity_type === "string") {
        payload.entity_type = (payload.entity_type as string).trim().toLowerCase();
      }
      const { error } = await db.from("entities").update(payload).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["entities"] });
      showToast.success("Saved");
    },
    onError: (e: any) => showToast.error(e.message ?? "Could not save"),
  });
}

export function useDeleteEntity() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db.from("entities").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["entities"] });
      qc.invalidateQueries({ queryKey: ["claims"] });
      showToast.success("Removed");
    },
    onError: (e: any) => showToast.error(e.message ?? "Could not remove it"),
  });
}

/** Moments linked to an entity through `moment_entities`, newest first. */
export function useEntityMoments(entityId: string | null) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["entity-moments", entityId, user?.id],
    enabled: !!user && !!entityId,
    queryFn: async () => {
      const { data: links, error: linkErr } = await db
        .from("moment_entities")
        .select("moment_id, role")
        .eq("user_id", user!.id)
        .eq("entity_id", entityId);
      if (linkErr) throw linkErr;
      const ids = ((links || []) as any[]).map((l) => l.moment_id);
      if (ids.length === 0) return [] as Array<{ id: string; title: string; happened_at: string; role: string | null }>;
      const roleById = new Map(((links || []) as any[]).map((l) => [l.moment_id, l.role ?? null]));
      const { data, error } = await db
        .from("moments")
        .select("id, title, happened_at, description")
        .in("id", ids)
        .is("deleted_at", null)
        .order("happened_at", { ascending: false });
      if (error) throw error;
      return ((data || []) as any[]).map((m) => ({ ...m, role: roleById.get(m.id) ?? null }));
    },
  });
}

/** Notes mentioning the entity by name or alias. */
export function useEntityNotes(entity: Entity | null) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["entity-notes", entity?.id, user?.id],
    enabled: !!user && !!entity,
    queryFn: async () => {
      const names = [entity!.name, ...(entity!.aliases || [])].filter(Boolean);
      if (names.length === 0) return [] as Array<{ id: string; title: string | null; created_at: string }>;
      // Names/aliases can contain PostgREST filter metacharacters (`,` `(` `)`)
      // and LIKE wildcards (`%` `_`); ilikeContains quotes and escapes both.
      const filter = names.flatMap((n) => [ilikeContains("title", n), ilikeContains("content", n)]).join(",");
      const { data, error } = await db
        .from("notes")
        .select("id, title, created_at")
        .eq("user_id", user!.id)
        .eq("is_trashed", false)
        .or(filter)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data || []) as Array<{ id: string; title: string | null; created_at: string }>;
    },
  });
}
