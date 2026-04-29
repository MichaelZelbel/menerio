import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database, Json } from "@/integrations/supabase/types";
import { useAuth } from "@/contexts/AuthContext";
import { showToast } from "@/lib/toast";

type ContactGroupRow = Database["public"]["Tables"]["contact_groups"]["Row"];
type MembershipRow = Database["public"]["Tables"]["contact_group_memberships"]["Row"];
type MembershipUpdate = Database["public"]["Tables"]["contact_group_memberships"]["Update"];

type ContactSummary = {
  id: string;
  name: string;
  aliases: string[] | null;
};

export type GroupMembershipWithPerson = MembershipRow & {
  contacts: ContactSummary | null;
};

export type PersonGroupMembership = MembershipRow & {
  contact_groups: ContactGroupRow | null;
};

type AddMembershipInput = {
  groupId: string;
  personId: string;
  status?: string | null;
  priority?: "low" | "normal" | "high" | "urgent";
};

type UpdateMembershipInput = Partial<Omit<MembershipUpdate, "id">> & {
  id: string;
  groupId: string;
  personId: string;
};

function invalidateMembershipQueries(
  qc: ReturnType<typeof useQueryClient>,
  groupId?: string | null,
  personId?: string | null,
) {
  if (groupId) qc.invalidateQueries({ queryKey: ["contact_group_memberships", groupId] });
  if (personId) qc.invalidateQueries({ queryKey: ["person_groups", personId] });
}

export function useGroupMemberships(groupId: string | null | undefined) {
  return useQuery<GroupMembershipWithPerson[]>({
    queryKey: ["contact_group_memberships", groupId],
    enabled: !!groupId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("contact_group_memberships")
        .select("*, contacts:contact_id(id, name, aliases)")
        .eq("group_id", groupId!)
        .is("archived_at", null)
        .order("position", { ascending: true });

      if (error) throw error;
      return ((data || []) as unknown) as GroupMembershipWithPerson[];
    },
  });
}

export function usePersonGroupMemberships(personId: string | null | undefined) {
  return useQuery<PersonGroupMembership[]>({
    queryKey: ["person_groups", personId],
    enabled: !!personId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("contact_group_memberships")
        .select("*, contact_groups:group_id(*)")
        .eq("contact_id", personId!)
        .is("archived_at", null)
        .order("updated_at", { ascending: false });

      if (error) throw error;
      return ((data || []) as unknown) as PersonGroupMembership[];
    },
  });
}

export function useAddMembership() {
  const qc = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({ groupId, personId, status, priority = "normal" }: AddMembershipInput) => {
      if (!user) throw new Error("Not authenticated");

      const { data: group, error: groupError } = await supabase
        .from("contact_groups")
        .select("stages")
        .eq("id", groupId)
        .single();

      if (groupError) throw groupError;
      const stages = Array.isArray(group?.stages) ? group.stages : [];
      const firstStage = stages[0] && typeof stages[0] === "object" && "id" in stages[0]
        ? String((stages[0] as { id: unknown }).id)
        : null;

      const { data, error } = await supabase
        .from("contact_group_memberships")
        .insert({
          group_id: groupId,
          contact_id: personId,
          user_id: user.id,
          status: status ?? firstStage,
          priority,
        })
        .select()
        .single();

      if (error) throw error;
      return data as MembershipRow;
    },
    onSuccess: (membership) => {
      invalidateMembershipQueries(qc, membership.group_id, membership.contact_id);
    },
    onError: (error: Error) => showToast.error(error.message),
  });
}

export function useUpdateMembership() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, groupId, personId, ...updates }: UpdateMembershipInput) => {
      const payload = {
        ...updates,
        attributes: updates.attributes as Json | undefined,
      };

      const { data, error } = await supabase
        .from("contact_group_memberships")
        .update(payload)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return { membership: data as MembershipRow, groupId, personId };
    },
    onSuccess: ({ membership, groupId, personId }) => {
      invalidateMembershipQueries(qc, groupId || membership.group_id, personId || membership.contact_id);
    },
    onError: (error: Error) => showToast.error(error.message),
  });
}

export function useRemoveMembership() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, groupId, personId }: { id: string; groupId: string; personId: string }) => {
      const { error } = await supabase
        .from("contact_group_memberships")
        .delete()
        .eq("id", id);

      if (error) throw error;
      return { groupId, personId };
    },
    onSuccess: ({ groupId, personId }) => {
      invalidateMembershipQueries(qc, groupId, personId);
    },
    onError: (error: Error) => showToast.error(error.message),
  });
}

export function useArchiveMembership() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, groupId, personId }: { id: string; groupId: string; personId: string }) => {
      const { data, error } = await supabase
        .from("contact_group_memberships")
        .update({ archived_at: new Date().toISOString() })
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return { membership: data as MembershipRow, groupId, personId };
    },
    onSuccess: ({ membership, groupId, personId }) => {
      invalidateMembershipQueries(qc, groupId || membership.group_id, personId || membership.contact_id);
    },
    onError: (error: Error) => showToast.error(error.message),
  });
}

export function useReorderMemberships() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({ groupId, orderedIds }: { groupId: string; orderedIds: string[] }) => {
      const updates = orderedIds.map((id, position) =>
        supabase
          .from("contact_group_memberships")
          .update({ position })
          .eq("id", id)
          .eq("group_id", groupId)
          .select("id, contact_id")
          .single(),
      );

      const results = await Promise.all(updates);
      const firstError = results.find((result) => result.error)?.error;
      if (firstError) throw firstError;

      return {
        groupId,
        personIds: results.map((result) => (result.data as Pick<MembershipRow, "contact_id">).contact_id),
      };
    },
    onSuccess: ({ groupId, personIds }) => {
      qc.invalidateQueries({ queryKey: ["contact_group_memberships", groupId] });
      personIds.forEach((personId) => qc.invalidateQueries({ queryKey: ["person_groups", personId] }));
    },
    onError: (error: Error) => showToast.error(error.message),
  });
}

export function useMoveMembershipStage() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({ membershipId, newStatus }: { membershipId: string; newStatus: string | null }) => {
      const { data, error } = await supabase
        .from("contact_group_memberships")
        .update({ status: newStatus })
        .eq("id", membershipId)
        .select()
        .single();

      if (error) throw error;
      return data as MembershipRow;
    },
    onSuccess: (membership) => {
      invalidateMembershipQueries(qc, membership.group_id, membership.contact_id);
    },
    onError: (error: Error) => showToast.error(error.message),
  });
}
