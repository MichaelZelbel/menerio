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

export function useReviewQueue() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const { data: items = [], isLoading } = useQuery({
    queryKey: ["review-queue", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("review_queue" as any)
        .select("*, source_note:notes!review_queue_source_note_id_fkey(title)")
        .in("status", ["pending", "pending_review", "auto_applied_unreviewed"])
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as ReviewItem[];
    },
    enabled: !!user,
    refetchInterval: 60_000,
  });

  const { data: pendingCount = 0 } = useQuery({
    queryKey: ["review-queue-count", user?.id],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("review_queue" as any)
        .select("id", { count: "exact", head: true })
        .in("status", ["pending", "pending_review", "auto_applied_unreviewed"]);
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

  return { items, isLoading, pendingCount, updateStatus };
}
