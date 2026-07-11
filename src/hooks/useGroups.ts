import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database, Json } from "@/integrations/supabase/types";
import { getTemplateById, instantiateTemplate } from "@/lib/group-templates";
import { useAuth } from "@/contexts/AuthContext";
import { showToast } from "@/lib/toast";

export type ContactGroupRow = Database["public"]["Tables"]["contact_groups"]["Row"];
type ContactGroupInsert = Database["public"]["Tables"]["contact_groups"]["Insert"];
type ContactGroupUpdate = Database["public"]["Tables"]["contact_groups"]["Update"];

// `parent_group_id` lives in the DB (Phase 1 migration) but not yet in the
// generated types — surface it here so callers can nest groups.
type CreateGroupFields = Omit<ContactGroupInsert, "user_id" | "slug"> & {
  slug?: string;
  parent_group_id?: string | null;
};

type CreateGroupInput = CreateGroupFields | { templateId: string; name?: string };

type CreateGroupBase = CreateGroupFields;

const slugify = (value: string) =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "group";

const isUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

const groupWikiSkeleton = (group: Pick<ContactGroupRow, "name" | "purpose">) => `# ${group.name}

## Purpose
${group.purpose || ""}

## Members
_Synced automatically from contact_group_memberships._

## Insights
_Synthesized from notes mentioning members._
`;

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
        // Alpha order gives the People tree a stable sidebar; no consumer
        // depends on recency ordering here.
        .order("name", { ascending: true });

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
        .eq("user_id", user!.id);

      const { data, error } = isUuid(idOrSlug!)
        ? await query.eq("id", idOrSlug!).maybeSingle()
        : await query.eq("slug", idOrSlug!).maybeSingle();
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
      const base: CreateGroupBase = templateInput
        ? (() => {
            const template = getTemplateById(templateInput.templateId);
            if (!template) throw new Error("Unknown group template");
            return instantiateTemplate(template, templateInput.name);
          })()
        : input as CreateGroupBase;

      const name = base.name.trim();
      const baseSlug = "slug" in base && base.slug ? base.slug : slugify(name);

      // Slug-collision retry: nesting invites same-name groups under different
      // parents, and the DB enforces UNIQUE (user_id, slug). On 23505 we retry
      // with a -2, -3, … suffix; any other error aborts immediately.
      let group: ContactGroupRow | null = null;
      let lastError: unknown = null;
      for (let attempt = 0; attempt < 25 && !group; attempt++) {
        const slug = attempt === 0 ? baseSlug : `${baseSlug}-${attempt + 1}`;
        const row = {
          ...base,
          user_id: user.id,
          name,
          slug,
          success_criteria: base.success_criteria as Json,
          stages: base.stages as Json,
          attributes_schema: base.attributes_schema as Json,
        } as ContactGroupInsert;

        const { data, error } = await supabase
          .from("contact_groups")
          .insert(row)
          .select()
          .single();

        if (!error) {
          group = data as ContactGroupRow;
          break;
        }
        if ((error as { code?: string }).code === "23505") {
          lastError = error;
          continue;
        }
        throw error;
      }
      if (!group) throw lastError ?? new Error("Could not create group");

      // The wiki page is a best-effort side effect: a failure here must not
      // roll back a successfully created group. Log + toast, then carry on.
      const { error: wikiError } = await supabase.from("wiki_pages").insert({
        user_id: user.id,
        slug: `group-${group.slug}`,
        page_type: "group",
        title: group.name,
        summary: group.purpose,
        metadata: { group_id: group.id },
        content: groupWikiSkeleton(group),
      });

      if (wikiError) {
        console.error("Group wiki page insert failed", wikiError);
        showToast.error("Group created; wiki page failed");
      }
      return group;
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
