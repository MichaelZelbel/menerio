import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface ReviewItem {
  id: string;
  user_id: string;
  source_note_id: string | null;
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
        .eq("status", "pending")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as ReviewItem[];
    },
    enabled: !!user,
  });

  const { data: pendingCount = 0 } = useQuery({
    queryKey: ["review-queue-count", user?.id],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("review_queue" as any)
        .select("id", { count: "exact", head: true })
        .eq("status", "pending");
      if (error) throw error;
      return count || 0;
    },
    enabled: !!user,
    refetchInterval: 60_000,
  });

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "accepted" | "dismissed" }) => {
      const { error } = await supabase
        .from("review_queue" as any)
        .update({ status, reviewed_at: new Date().toISOString() } as any)
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
