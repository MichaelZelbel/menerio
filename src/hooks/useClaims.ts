import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { showToast } from "@/lib/toast";
import { normalizeAttribute, todayISO, type Claim, type ClaimConfidence, type ClaimSubjectType } from "@/lib/claims";
import {
  attributeLabel,
  describeWriteResult,
  invalidateFactViews,
  invokeWriteFact,
  retractFact,
} from "@/hooks/useFacts";

export type { Claim } from "@/lib/claims";

const db = supabase as any;

// Every column except `embedding`. `*` shipped each claim's vector (1,536
// floats as text, about 19 kB) to a list that shows attribute and value, and
// the list is persisted to IndexedDB.
const CLAIM_COLUMNS =
  "id, user_id, subject_type, subject_id, attribute, value, value_json, valid_from, valid_to, confidence, cardinality, evidence_quote, review_by, source_type, source_id, origin, created_at, updated_at";

/**
 * World reads the same claims through the `world_claims` view under its own
 * key; without this a fact added or ended on a person page kept its old state
 * on the World page for the cache lifetime (and across reloads).
 */
function invalidateClaimViews(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: ["claims"] });
  qc.invalidateQueries({ queryKey: ["world-claims"] });
}

/** All claims (current AND history) for one subject. Filtering happens in the UI. */
export function useClaims(subjectType: ClaimSubjectType, subjectId: string | null) {
  const { user } = useAuth();

  return useQuery<Claim[]>({
    queryKey: ["claims", subjectType, subjectId ?? "self", user?.id],
    enabled: !!user && (subjectType === "self" || !!subjectId),
    queryFn: async () => {
      let q = db
        .from("claims")
        .select(CLAIM_COLUMNS)
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
  source_type?: "manual" | "note" | "moment" | "ai";
  source_id?: string | null;
}

/**
 * Adds a fact through the one add path (normalize-profile `write_fact`, with
 * the user's JWT). writeFact decides cardinality, closes the older value of a
 * single-valued attribute (it becomes history), creates the slot and refuses
 * a value the user marked as wrong.
 */
export function useAddClaim() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (input: AddClaimInput) => {
      const attribute = normalizeAttribute(input.attribute);
      if (!attribute) throw new Error("An attribute is required");
      if (!input.value.trim()) throw new Error("A value is required");
      if (input.subject_type !== "self" && !input.subject_id) throw new Error("Nothing to add the fact to");

      const result = await invokeWriteFact({
        contact_id: input.subject_type === "contact" ? input.subject_id : null,
        entity_id: input.subject_type === "entity" ? input.subject_id : null,
        label: attributeLabel(attribute),
        attribute,
        value: input.value.trim(),
        valid_from: input.valid_from || null,
        source_type: input.source_type && input.source_type !== "manual" ? input.source_type : undefined,
        source_id: input.source_id || undefined,
      });
      const recorded = result.facts.find((f) => f.claimId && (f.outcome === "inserted" || f.outcome === "already_recorded"));
      return {
        claim: { id: recorded?.claimId ?? null } as { id: string | null },
        superseded: result.facts.reduce((n, f) => n + (f.closed ?? 0), 0),
        facts: result.facts,
      };
    },
    onSuccess: (result) => {
      invalidateFactViews(qc);
      const told = describeWriteResult(result.facts);
      if (told.kind === "success") showToast.success(told.message);
      else showToast.info(told.message);
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
      invalidateClaimViews(qc);
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
      invalidateClaimViews(qc);
      showToast.success("Marked as no longer true and kept in history");
    },
    onError: (e: any) => showToast.error(e.message ?? "Could not update the fact"),
  });
}

/**
 * "Was wrong": hard delete, only for facts the user says never happened. The
 * value is remembered so it is not suggested again.
 */
export function useDeleteClaim() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (claim: Pick<Claim, "id" | "subject_type" | "subject_id" | "attribute" | "value">) => {
      await retractFact({
        claim_id: claim.id,
        subject_type: claim.subject_type,
        subject_id: claim.subject_id,
        attribute: claim.attribute,
        category_slug: null,
        value: claim.value,
      });
    },
    onSuccess: () => {
      invalidateClaimViews(qc);
      invalidateFactViews(qc);
      showToast.success("Fact removed. It will not be suggested again.");
    },
    onError: (e: any) => showToast.error(e.message ?? "Could not remove the fact"),
  });
}
