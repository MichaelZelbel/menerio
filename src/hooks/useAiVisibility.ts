import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { showToast } from "@/lib/toast";

export type AiVisibility = "visible" | "hidden";
export type AiKind = "notes" | "contacts" | "moments" | "collection_items" | "action_items";

/**
 * Toggle whether an item is visible to AI pipelines.
 *
 * When `hidden`:
 *  - The item is excluded from all MCP tool responses.
 *  - It is skipped by the Lexicon ingestion pipeline.
 *  - It does NOT contribute to People profile enrichment.
 *  - It is not rendered as a node in the Knowledge Graph.
 *  - It is not used as context by the in-app AI chat or daily digest.
 *  - Embeddings ARE still generated so the user can find the note via local
 *    semantic / keyword search — only AI-facing surfaces filter it out.
 */
export function useToggleAiVisibility(kind: AiKind) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, visibility }: { id: string; visibility: AiVisibility }) => {
      const { error } = await (supabase as any)
        .from(kind)
        .update({ ai_visibility: visibility })
        .eq("id", id);
      if (error) throw error;
      return { id, visibility };
    },
    onSuccess: ({ visibility }) => {
      qc.invalidateQueries({ queryKey: [kind] });
      qc.invalidateQueries({ queryKey: ["notes"] });
      qc.invalidateQueries({ queryKey: ["contacts"] });
      qc.invalidateQueries({ queryKey: ["ai_hidden_counts"] });
      showToast.success(
        visibility === "hidden"
          ? "Hidden from AI — excluded from Lexicon, People, Graph, AI Chat & MCP"
          : "Visible to AI again"
      );
    },
    onError: (e: any) => {
      showToast.error(e.message ?? "Failed to update AI visibility");
    },
  });
}

/**
 * Mark a contact (person) as sensitive. When sensitive:
 *  - The contact itself is redacted (only name/relationship exposed to AI)
 *  - All notes/moments/action_items linked to this person are automatically
 *    hidden from AI features, without needing per-item toggles.
 */
export function useToggleSensitivePerson() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, isSensitive }: { id: string; isSensitive: boolean }) => {
      const { error } = await (supabase as any)
        .from("contacts")
        .update({ is_sensitive: isSensitive })
        .eq("id", id);
      if (error) throw error;
      return { id, isSensitive };
    },
    onSuccess: ({ isSensitive }) => {
      qc.invalidateQueries({ queryKey: ["contacts"] });
      qc.invalidateQueries({ queryKey: ["people"] });
      qc.invalidateQueries({ queryKey: ["ai_hidden_counts"] });
      showToast.success(
        isSensitive
          ? "Marked sensitive — hidden from all AI features"
          : "No longer sensitive — visible to AI again"
      );
    },
    onError: (e: any) => {
      showToast.error(e.message ?? "Failed to update sensitive flag");
    },
  });
}
