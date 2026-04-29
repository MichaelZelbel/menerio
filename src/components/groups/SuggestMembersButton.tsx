import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAICredits } from "@/hooks/useAICredits";
import { showToast } from "@/lib/toast";
import { triggerCreditsRefresh } from "@/lib/credits-events";

type SuggestMembersResult = {
  suggestions_added: number;
  auto_applied?: number;
  structured_import?: { source_note?: { title?: string | null }; parsed_rows?: number; created_contacts?: number; imported_members?: number; updated_members?: number };
};

export function SuggestMembersButton({ groupId }: { groupId: string }) {
  const qc = useQueryClient();
  const { credits } = useAICredits();
  const suggestMembers = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke<SuggestMembersResult>("suggest-group-members", { body: { group_id: groupId } });
      if (error) throw error;
      return data || { suggestions_added: 0, auto_applied: 0 };
    },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ["review-queue"] });
      qc.invalidateQueries({ queryKey: ["review-queue-count"] });
      qc.invalidateQueries({ queryKey: ["contact_group_memberships", groupId] });
      qc.invalidateQueries({ queryKey: ["contact_groups"] });
      triggerCreditsRefresh();
      if (result.structured_import) {
        const imported = result.structured_import.imported_members || 0;
        const updated = result.structured_import.updated_members || 0;
        showToast.success(`${imported} member${imported === 1 ? "" : "s"} imported${updated > 0 ? ` · ${updated} updated` : ""}`);
        return;
      }
      const added = result.suggestions_added - (result.auto_applied || 0);
      if (result.auto_applied) showToast.success(`${result.auto_applied} member${result.auto_applied === 1 ? "" : "s"} added${added > 0 ? ` · ${added} in Review Queue` : ""}`);
      else showToast.success(`${result.suggestions_added} suggestion${result.suggestions_added === 1 ? "" : "s"} added to Review Queue`);
    },
    onError: (error: Error) => showToast.error(error.message || "Could not suggest members"),
  });

  return (
    <Button variant="outline" size="sm" className="gap-1.5" onClick={() => suggestMembers.mutate()} disabled={suggestMembers.isPending || (credits?.remainingCredits ?? 0) < 20}>
      {suggestMembers.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} AI Match Members
    </Button>
  );
}
