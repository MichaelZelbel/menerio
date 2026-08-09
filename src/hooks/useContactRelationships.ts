import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { relationshipPairKey, type EntityRef } from "@/lib/relationship-canonical";
import { relationshipWriteDecision } from "@/lib/profile-integrity";

export interface ContactRelationship {
  id: string;
  user_id: string;
  source_type: string;
  source_id: string | null;
  target_type: string;
  target_id: string | null;
  label: string;
  custom_label: string | null;
  inverse_id: string | null;
  /** Where this row came from. "unverified" = legacy, nobody vouched for it. */
  origin: string;
  evidence_quote: string | null;
  evidence_note_id: string | null;
  created_at: string;
  updated_at: string;
  // Joined names for display
  source_contact?: { id: string; name: string } | null;
  target_contact?: { id: string; name: string } | null;
}

/**
 * Fetch all relationships for a given entity (contact or self).
 * Returns relationships where the entity is either source or target.
 */
export function useContactRelationships(contactId: string | null) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const queryKey = ["contact-relationships", contactId ?? "self"];

  const { data: relationships = [], isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      if (!user) return [];

      // We need to fetch all relationships and filter for ones involving this entity
      // Since we can't do OR in supabase-js easily with different column combos,
      // fetch all user relationships and filter client-side (typically small set)
      const { data, error } = await supabase
        .from("contact_relationships")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });

      if (error) throw error;

      // Filter to relationships involving this entity
      const filtered = (data || []).filter((r: any) => {
        if (contactId === null) {
          // Viewing self/my profile
          return r.source_type === "self" || r.target_type === "self";
        }
        return (
          (r.source_type === "contact" && r.source_id === contactId) ||
          (r.target_type === "contact" && r.target_id === contactId)
        );
      });

      // Fetch contact names for display
      const contactIds = new Set<string>();
      for (const r of filtered) {
        if (r.source_type === "contact" && r.source_id) contactIds.add(r.source_id);
        if (r.target_type === "contact" && r.target_id) contactIds.add(r.target_id);
      }

      const contactMap = new Map<string, string>();
      if (contactIds.size > 0) {
        const { data: contacts } = await supabase
          .from("contacts")
          .select("id, name")
          .in("id", [...contactIds]);
        for (const c of contacts || []) {
          contactMap.set(c.id, c.name);
        }
      }

      return filtered.map((r: any) => ({
        ...r,
        source_contact: r.source_type === "contact" && r.source_id
          ? { id: r.source_id, name: contactMap.get(r.source_id) || "Unknown" }
          : null,
        target_contact: r.target_type === "contact" && r.target_id
          ? { id: r.target_id, name: contactMap.get(r.target_id) || "Unknown" }
          : null,
      })) as ContactRelationship[];
    },
    enabled: !!user,
  });

  const upsertRelationship = useMutation({
    mutationFn: async (data: {
      id?: string;
      source_type: string;
      source_id: string | null;
      target_type: string;
      target_id: string | null;
      label: string;
      custom_label?: string | null;
    }) => {
       if (!user) throw new Error("Not authenticated");

       const decision = relationshipWriteDecision({
         userId: user.id,
         sourceType: data.source_type as "contact" | "self",
         sourceId: data.source_id,
         targetType: data.target_type as "contact" | "self",
         targetId: data.target_id,
         label: data.label,
       });
       if (decision.ok === false) throw new Error(decision.reason);
       const canonical = decision.label;
       const aRef: EntityRef = { type: data.source_type as "contact" | "self", id: data.source_id };
       const bRef: EntityRef = { type: data.target_type as "contact" | "self", id: data.target_id };
       const pairKey = relationshipPairKey(user.id, aRef, bRef, canonical);

      // Symmetric dedup against existing rows (skip on update of same row).
      const { data: existing } = await supabase
        .from("contact_relationships")
        .select("id, source_type, source_id, target_type, target_id, label")
        .eq("user_id", user.id);
      const dup = (existing || []).find((r: any) => {
        if (data.id && r.id === data.id) return false;
        const ra: EntityRef = { type: r.source_type, id: r.source_id };
        const rb: EntityRef = { type: r.target_type, id: r.target_id };
        return relationshipPairKey(user.id, ra, rb, r.label) === pairKey;
      });
      if (dup) throw new Error("pair_key: equivalent relationship already exists");

      // A person is sitting in front of this form: that is the only origin
      // exempt from the evidence gate.
      const row = { ...data, label: canonical, user_id: user.id, origin: "user_manual" };

      if (data.id) {
        const { error } = await supabase
          .from("contact_relationships")
          .update(row)
          .eq("id", data.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("contact_relationships")
          .insert(row);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["contact-relationships"] });
    },
  });

  const deleteRelationship = useMutation({
    mutationFn: async (id: string) => {
      const rel = relationships.find((r) => r.id === id);

      // A manual removal is a statement of fact: "this relationship is wrong".
      // Record it so no automated pipeline can ever re-create it. Only a manual
      // re-add clears the rejection (handled by the DB guard).
      if (rel && user) {
        const pairKey = relationshipPairKey(
          user.id,
          { type: rel.source_type as EntityRef["type"], id: rel.source_id },
          { type: rel.target_type as EntityRef["type"], id: rel.target_id },
          rel.custom_label || rel.label,
        );
        await supabase
          .from("relationship_rejections")
          .upsert(
            {
              user_id: user.id,
              pair_key: pairKey,
              rejected_label: rel.custom_label || rel.label,
              reason: "Removed by the user from the profile UI",
            },
            { onConflict: "user_id,pair_key" },
          );
      }

      // Also delete the inverse if it exists
      if (rel?.inverse_id) {
        await supabase
          .from("contact_relationships")
          .delete()
          .eq("id", rel.inverse_id);
      }
      const { error } = await supabase
        .from("contact_relationships")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },

    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["contact-relationships"] });
    },
  });

  /**
   * A person looked at an unverified legacy row and vouched for it. That turns
   * it into a manual fact, which is the only origin allowed without evidence.
   */
  const confirmRelationship = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("contact_relationships")
        .update({ origin: "user_manual" })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["contact-relationships"] });
    },
  });

  return {
    relationships,
    isLoading,
    upsertRelationship,
    deleteRelationship,
    confirmRelationship,
  };
}

