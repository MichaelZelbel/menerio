import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface ReviewItem {
  id: string;
  user_id: string;
  source_note_id: string | null;
  target_entity_type: string | null;
  target_entity_id: string | null;
  source_title: string | null;
  extracted_value: string | null;
  confidence_score: number | null;
  is_sensitive: boolean;
  applied_at: string | null;
  blocked_at: string | null;
  suppression_key: string | null;
  suggestion_type: string;
  title: string;
  description: string | null;
  payload: Record<string, any>;
  status: string;
  created_at: string;
  reviewed_at: string | null;
  source_note?: { title: string } | null;
}

export interface WikiRevisionReviewItem {
  id: string;
  user_id: string;
  wiki_page_id: string | null;
  page_slug: string;
  page_title: string;
  change_type: "created" | "updated";
  previous_content: string | null;
  new_content: string;
  source_note_id: string | null;
  change_summary: string | null;
  status: "applied";
  created_at: string;
  reviewed_at: string | null;
  rolled_back_at: string | null;
  source_note?: { id: string; title: string } | null;
}

export function useReviewQueue() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const { data: items = [], isLoading } = useQuery({
    queryKey: ["review-queue", user?.id],
    queryFn: async () => {
      // Only fetch the columns a card actually renders, and cap at 500 rows.
      // The full count is served by the separate head:true query below.
      const { data, error } = await supabase
        .from("review_queue" as any)
        .select("id,user_id,suggestion_type,target_entity_id,target_entity_type,applied_at,source_note_id,suppression_key,extracted_value,is_sensitive,title,description,payload,status,created_at,reviewed_at,confidence_score,blocked_at, source_note:notes!review_queue_source_note_id_fkey(title)")
        .in("status", ["pending", "pending_review", "auto_applied_unreviewed"])
        .or(`snoozed_until.is.null,snoozed_until.lte.${new Date().toISOString()}`)
        .order("created_at", { ascending: false })
        .range(0, 499);
      if (error) throw error;
      return (data || []) as unknown as ReviewItem[];
    },
    enabled: !!user,
    // No polling on the heavy list — the count badge below refreshes instead.
    staleTime: 30_000,
  });

  const { data: pendingCount = 0 } = useQuery({
    queryKey: ["review-queue-count", user?.id],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("review_queue" as any)
        .select("id", { count: "exact", head: true })
        .in("status", ["pending", "pending_review", "auto_applied_unreviewed"])
        .or(`snoozed_until.is.null,snoozed_until.lte.${new Date().toISOString()}`);
      if (error) throw error;
      return count || 0;
    },
    enabled: !!user,
    refetchInterval: 60_000,
  });

  const { data: wikiRevisions = [], isLoading: isLoadingWikiRevisions } = useQuery({
    queryKey: ["wiki-revision-review-queue", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("wiki_revisions" as any)
        .select("*, source_note:notes!wiki_revisions_source_note_id_fkey(id,title)")
        .eq("status", "applied")
        .in("change_type", ["created", "updated"])
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as WikiRevisionReviewItem[];
    },
    enabled: !!user,
    refetchInterval: 60_000,
  });

  const { data: wikiRevisionCount = 0 } = useQuery({
    queryKey: ["wiki-revision-review-count", user?.id],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("wiki_revisions" as any)
        .select("id", { count: "exact", head: true })
        .eq("status", "applied")
        .in("change_type", ["created", "updated"]);
      if (error) throw error;
      return count || 0;
    },
    enabled: !!user,
    refetchInterval: 60_000,
  });

  const updateStatus = useMutation({
    mutationFn: async ({ id, status, extra }: { id: string; status: "kept" | "removed" | "blocked" | "pending_review" | "auto_applied_unreviewed"; extra?: Record<string, unknown> }) => {
      const { error } = await supabase
        .from("review_queue" as any)
        .update({ status, reviewed_at: new Date().toISOString(), ...extra } as any)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["review-queue"] });
      queryClient.invalidateQueries({ queryKey: ["review-queue-count"] });
    },
  });

  return {
    items,
    wikiRevisions,
    isLoading: isLoading || isLoadingWikiRevisions,
    pendingCount: pendingCount + wikiRevisionCount,
    updateStatus,
  };
}
