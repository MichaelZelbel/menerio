import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { showToast } from "@/lib/toast";
import {
  claimsToSupersede,
  normalizeAttribute,
  supersedeDate,
  todayISO,
  type Claim,
  type ClaimConfidence,
  type ClaimSubjectType,
} from "@/lib/claims";

export type { Claim } from "@/lib/claims";

const db = supabase as any;

/** All claims (current AND history) for one subject. Filtering happens in the UI. */
export function useClaims(subjectType: ClaimSubjectType, subjectId: string | null) {
  const { user } = useAuth();

  return useQuery<Claim[]>({
    queryKey: ["claims", subjectType, subjectId ?? "self", user?.id],
    enabled: !!user && (subjectType === "self" || !!subjectId),
    queryFn: async () => {
      let q = db
        .from("claims")
        .select("*")
        .eq("user_id", user!.id)
        .eq("subject_type", subjectType);
      q = subjectType === "self" ? q.is("subject_id", null) : q.eq("subject_id", subjectId);
      const { data, error } = await q.order("valid_from", { ascending: false, nullsFirst: false });
      if (error) throw error;
      return (data || []) as Claim[];
    },
  });
}

export interface AddClaimInput {
  subject_type: ClaimSubjectType;
  subject_id: string | null;
  attribute: string;
  value: string;
  valid_from?: string | null;
  confidence?: ClaimConfidence;
  source_type?: "manual" | "note" | "moment" | "ai";
  source_id?: string | null;
}

/**
 * Adds a claim and ends any overlapping open claim on the same
 * subject + attribute. Superseded claims are closed with a `valid_to`,
 * never deleted.
 */
export function useAddClaim() {
  const qc = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (input: AddClaimInput) => {
      const attribute = normalizeAttribute(input.attribute);
      if (!attribute) throw new Error("An attribute is required");
      if (!input.value.trim()) throw new Error("A value is required");

      let q = db
        .from("claims")
        .select("*")
        .eq("user_id", user!.id)
        .eq("subject_type", input.subject_type)
        .eq("attribute", attribute);
      q = input.subject_type === "self" ? q.is("subject_id", null) : q.eq("subject_id", input.subject_id);
      const { data: existing } = await q;

      const toClose = claimsToSupersede((existing || []) as Claim[], {
        attribute,
        valid_from: input.valid_from ?? null,
      });
      const endDate = supersedeDate({ valid_from: input.valid_from ?? null });
      for (const claim of toClose) {
        await db.from("claims").update({ valid_to: endDate }).eq("id", claim.id);
      }

      const { data, error } = await db
        .from("claims")
        .insert({
          user_id: user!.id,
          subject_type: input.subject_type,
          subject_id: input.subject_type === "self" ? null : input.subject_id,
          attribute,
          value: input.value.trim(),
          valid_from: input.valid_from || null,
          confidence: input.confidence || "likely",
          source_type: input.source_type || "manual",
          source_id: input.source_id || null,
        })
        .select("*")
        .single();
      if (error) throw error;
      return { claim: data as Claim, superseded: toClose.length };
    },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ["claims"] });
      showToast.success(
        result.superseded > 0 ? "Fact added — the previous one moved to history" : "Fact added",
      );
    },
    onError: (e: any) => showToast.error(e.message ?? "Could not add the fact"),
  });
}

export function useUpdateClaim() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      ...updates
    }: { id: string } & Partial<Pick<Claim, "attribute" | "value" | "valid_from" | "valid_to" | "confidence">>) => {
      const payload: Record<string, unknown> = { ...updates };
      if (typeof payload.attribute === "string") payload.attribute = normalizeAttribute(payload.attribute);
      const { error } = await db.from("claims").update(payload).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["claims"] });
      showToast.success("Fact updated");
    },
    onError: (e: any) => showToast.error(e.message ?? "Could not update the fact"),
  });
}

/** "No longer true" — closes the claim instead of deleting it. */
export function useEndClaim() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, endDate }: { id: string; endDate?: string }) => {
      const { error } = await db.from("claims").update({ valid_to: endDate || todayISO() }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["claims"] });
      showToast.success("Marked as no longer true — kept in history");
    },
    onError: (e: any) => showToast.error(e.message ?? "Could not update the fact"),
  });
}

/** Hard delete, only for facts the user says never happened. */
export function useDeleteClaim() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db.from("claims").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["claims"] });
      showToast.success("Fact removed");
    },
    onError: (e: any) => showToast.error(e.message ?? "Could not remove the fact"),
  });
}
