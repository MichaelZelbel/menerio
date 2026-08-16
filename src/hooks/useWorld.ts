import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { ClaimRow } from "@/lib/world-claims";

/**
 * World reads three database views, and the views read the tables that were
 * already full: contacts, moments, profile entries and relationships.
 *
 * There is no `world` table and there is no extractor filling one. A second
 * store would have meant a second copy of all 226 contacts, and every name
 * would exist twice. This is the rule the whole World design rests on.
 */

export interface WorldEntityRow {
  id: string;
  user_id: string;
  source_table: "contact" | "entity";
  kind: string;
  name: string;
  aliases: string[] | null;
  description: string | null;
  ai_visibility: string;
  is_sensitive: boolean;
  created_at: string;
  updated_at: string;
}

export interface WorldEventRow {
  id: string;
  user_id: string;
  source_table: "moment";
  title: string;
  description: string | null;
  happened_at: string;
  happened_end: string | null;
  person_id: string | null;
  category: string | null;
  status: string;
  ai_visibility: string;
  created_at: string;
  updated_at: string;
}

const db = supabase as any;

export function useWorldEntities() {
  const { user } = useAuth();

  return useQuery<WorldEntityRow[]>({
    queryKey: ["world-entities", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await db
        .from("world_entities")
        .select("*")
        .eq("user_id", user!.id)
        .order("name");
      if (error) throw error;
      return ((data || []) as any[]).map((row) => ({
        ...row,
        aliases: row.aliases || [],
      })) as WorldEntityRow[];
    },
  });
}

export function useWorldEvents() {
  const { user } = useAuth();

  return useQuery<WorldEventRow[]>({
    queryKey: ["world-events", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await db
        .from("world_events")
        .select("*")
        .eq("user_id", user!.id)
        .order("happened_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data || []) as WorldEventRow[];
    },
  });
}

export function useWorldClaims() {
  const { user } = useAuth();

  return useQuery<ClaimRow[]>({
    queryKey: ["world-claims", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await db
        .from("world_claims")
        .select("*")
        .eq("user_id", user!.id)
        .order("updated_at", { ascending: false })
        .limit(2000);
      if (error) throw error;
      return (data || []) as ClaimRow[];
    },
  });
}
