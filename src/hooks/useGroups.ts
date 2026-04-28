import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database, Json } from "@/integrations/supabase/types";
import { getTemplateById, instantiateTemplate } from "@/lib/group-templates";
import { useAuth } from "@/contexts/AuthContext";
import { showToast } from "@/lib/toast";

type ContactGroupRow = Database["public"]["Tables"]["contact_groups"]["Row"];
type ContactGroupInsert = Database["public"]["Tables"]["contact_groups"]["Insert"];
type ContactGroupUpdate = Database["public"]["Tables"]["contact_groups"]["Update"];

type CreateGroupInput =
  | (Omit<ContactGroupInsert, "user_id" | "slug"> & { slug?: string })
  | { templateId: string; name?: string };

const slugify = (value: string) =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "group";

function isTemplateCreateInput(input: CreateGroupInput): input is { templateId: string; name?: string } {
  return "templateId" in input;
}

export function useGroups() {
  const { user } = useAuth();

  return useQuery<ContactGroupRow[]>({
    queryKey: ["contact_groups", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("contact_groups")
        .select("*")
        .eq("user_id", user!.id)
        .eq("is_trashed", false)
        .order("updated_at", { ascending: false });

      if (error) throw error;
      return (data || []) as ContactGroupRow[];
    },
  });
}

export function useGroup(idOrSlug: string | null | undefined) {
  const { user } = useAuth();

  return useQuery<ContactGroupRow | null>({
    queryKey: ["contact_group", idOrSlug],
    enabled: !!user && !!idOrSlug,
    queryFn: async () => {
      const query = supabase
        .from("contact_groups")
        .select("*")
        .eq("user_id", user!.id)
        .or(`id.eq.${idOrSlug},slug.eq.${idOrSlug}`)
        .maybeSingle();

      const { data, error } = await query;
      if (error) throw error;
      return (data as ContactGroupRow | null) || null;
    },
  });
}

export function useCreateGroup() {
  const qc = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (input: CreateGroupInput) => {
      if (!user) throw new Error("Not authenticated");

      const templateInput = isTemplateCreateInput(input) ? input : null;
      const base = templateInput
        ? (() => {
            const template = getTemplateById(templateInput.templateId);
            if (!template) throw new Error("Unknown group template");
            return instantiateTemplate(template, templateInput.name);
          })()
        : input;

      const name = base.name.trim();
      const row: ContactGroupInsert = {
        ...base,
        user_id: user.id,
        name,
        slug: "slug" in base && base.slug ? base.slug : slugify(name),
        success_criteria: base.success_criteria as Json,
        stages: base.stages as Json,
        attributes_schema: base.attributes_schema as Json,
      };

      const { data, error } = await supabase
        .from("contact_groups")
        .insert(row)
        .select()
        .single();

      if (error) throw error;
      return data as ContactGroupRow;
    },
    onSuccess: (group) => {
      qc.invalidateQueries({ queryKey: ["contact_groups"] });
      qc.invalidateQueries({ queryKey: ["contact_group", group.id] });
      qc.invalidateQueries({ queryKey: ["contact_group", group.slug] });
    },
    onError: (error: Error) => showToast.error(error.message),
  });
}

export function useUpdateGroup() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...updates }: ContactGroupUpdate & { id: string }) => {
      const { data, error } = await supabase
        .from("contact_groups")
        .update(updates)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return data as ContactGroupRow;
    },
    onSuccess: (group) => {
      qc.invalidateQueries({ queryKey: ["contact_groups"] });
      qc.invalidateQueries({ queryKey: ["contact_group", group.id] });
      qc.invalidateQueries({ queryKey: ["contact_group", group.slug] });
    },
    onError: (error: Error) => showToast.error(error.message),
  });
}

export function useTrashGroup() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase
        .from("contact_groups")
        .update({ is_trashed: true })
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return data as ContactGroupRow;
    },
    onSuccess: (group) => {
      qc.invalidateQueries({ queryKey: ["contact_groups"] });
      qc.invalidateQueries({ queryKey: ["contact_group", group.id] });
      qc.invalidateQueries({ queryKey: ["contact_group", group.slug] });
    },
  });
}

export function useArchiveGroup() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase
        .from("contact_groups")
        .update({ archived_at: new Date().toISOString() })
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return data as ContactGroupRow;
    },
    onSuccess: (group) => {
      qc.invalidateQueries({ queryKey: ["contact_groups"] });
      qc.invalidateQueries({ queryKey: ["contact_group", group.id] });
      qc.invalidateQueries({ queryKey: ["contact_group", group.slug] });
    },
  });
}

export function useRestoreGroup() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase
        .from("contact_groups")
        .update({ is_trashed: false, archived_at: null })
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return data as ContactGroupRow;
    },
    onSuccess: (group) => {
      qc.invalidateQueries({ queryKey: ["contact_groups"] });
      qc.invalidateQueries({ queryKey: ["contact_group", group.id] });
      qc.invalidateQueries({ queryKey: ["contact_group", group.slug] });
    },
  });
}
