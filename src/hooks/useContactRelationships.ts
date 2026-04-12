import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

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

      let contactMap = new Map<string, string>();
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

      const row = {
        ...data,
        user_id: user.id,
      };

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
      // Also delete the inverse if it exists
      const rel = relationships.find((r) => r.id === id);
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

  return {
    relationships,
    isLoading,
    upsertRelationship,
    deleteRelationship,
  };
}
