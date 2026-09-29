import { supabase } from "@/integrations/supabase/client";
import { factSuppressionKey } from "@/hooks/useFacts";

/**
 * Rolling back an applied profile fact from the review queue: "this was
 * wrong". Same rules as review-queue-bulk's revertFact, so one item and "Roll
 * back all" behave alike.
 *
 * The item's target is the claim it wrote; a value that was split into
 * several facts lists every claim in payload.claim_ids. Each claim gets its
 * "never suggest again" row first, then is deleted.
 *
 * Not revertible, and left in the queue:
 * - items the fact-store switch marked so (their entry was folded into
 *   another claim, or no longer existed);
 * - applied items that still point at something other than a claim;
 * - claims a human has made their own since (rank 'preferred').
 *
 * A suggestion still waiting for Keep wrote nothing, so there is nothing to
 * roll back. A new profile field waiting for Keep points at the person it is
 * about (target 'self' or 'contact'), not at a claim; taking that pointer for
 * a written fact refused Roll Back and Never Again on it (2026-09-29).
 */

export interface RevertableItem {
  target_entity_id: string | null;
  target_entity_type: string | null;
  applied_at?: string | null;
  payload: Record<string, any> | null;
}

/** Whether the item wrote a fact that a rollback would have to delete. */
export function itemWroteFact(item: RevertableItem): boolean {
  if (!item.target_entity_id) return false;
  return item.target_entity_type === "claim" || !!item.applied_at;
}

export class FactNotRevertible extends Error {}

const NOT_REVERTIBLE = "This fact cannot be rolled back: it was merged with another fact or has changed since. Edit it on the profile instead.";
const MADE_YOUR_OWN = "This fact cannot be rolled back: you have edited it since. Remove it on the profile instead.";

/** Why an item cannot be rolled back, from the item alone (null = it may be). */
export function factRevertBlockReason(item: RevertableItem): string | null {
  if (!item.target_entity_id) return null;
  const switchInfo = (item.payload?.fact_store_switch ?? {}) as { revertible?: boolean; entry_missing?: boolean };
  if (switchInfo.revertible === false || switchInfo.entry_missing === true) return NOT_REVERTIBLE;
  if (item.target_entity_type !== "claim") return NOT_REVERTIBLE;
  return null;
}

/** Every claim an applied item wrote. */
export function itemClaimIds(item: RevertableItem): string[] {
  const extra = Array.isArray(item.payload?.claim_ids) ? item.payload!.claim_ids.map(String) : [];
  return [...new Set([item.target_entity_id, ...extra].filter((id): id is string => !!id))];
}

/**
 * Delete the claims an applied item wrote, each with a suppression row.
 * Throws FactNotRevertible when the rules above forbid it.
 */
export async function revertFactItem(item: RevertableItem): Promise<void> {
  if (!itemWroteFact(item)) return; // nothing was written
  const blocked = factRevertBlockReason(item);
  if (blocked) throw new FactNotRevertible(blocked);

  const { data, error } = await supabase
    .from("claims")
    .select("id, subject_type, subject_id, attribute, value, rank")
    .in("id", itemClaimIds(item));
  if (error) throw error;
  const claims = (data ?? []) as Array<{
    id: string;
    subject_type: "self" | "contact" | "entity";
    subject_id: string | null;
    attribute: string;
    value: string;
    rank: string;
  }>;
  if (claims.some((c) => c.rank === "preferred")) throw new FactNotRevertible(MADE_YOUR_OWN);

  for (const c of claims) {
    // The suppression first: should the delete fail, the value is still never
    // suggested again, and the item stays in the queue for another try.
    const { error: suppressError } = await supabase.from("ai_suggestion_suppressions").upsert(
      {
        suggestion_type: "claim",
        target_entity_type: "claim",
        target_entity_id: c.id,
        normalized_value: String(c.value ?? "").trim().toLowerCase(),
        suppression_key: factSuppressionKey(c, c.value),
      },
      { onConflict: "user_id,suppression_key" },
    );
    if (suppressError) throw suppressError;
    const { data: deleted, error: deleteError } = await supabase.from("claims").delete().eq("id", c.id).select("id");
    if (deleteError) throw deleteError;
    // A claim guard can cancel a delete without an error; say so.
    if (!deleted || deleted.length === 0) throw new Error("The fact could not be deleted.");
  }
}
