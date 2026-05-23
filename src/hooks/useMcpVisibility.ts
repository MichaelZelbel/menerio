import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { showToast } from "@/lib/toast";

export type McpVisibility = "visible" | "hidden";
export type McpKind = "notes" | "contacts" | "moments" | "collection_items" | "action_items";

/**
 * Toggle whether an object is visible to MCP clients.
 * Backend filtering lives in supabase/functions/open-brain-mcp/_mcp_visibility.ts
 */
export function useToggleMcpVisibility(kind: McpKind) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, visibility }: { id: string; visibility: McpVisibility }) => {
      const { error } = await (supabase as any)
        .from(kind)
        .update({ mcp_visibility: visibility })
        .eq("id", id);
      if (error) throw error;
      return { id, visibility };
    },
    onSuccess: ({ visibility }) => {
      qc.invalidateQueries({ queryKey: [kind] });
      qc.invalidateQueries({ queryKey: ["notes"] });
      qc.invalidateQueries({ queryKey: ["contacts"] });
      qc.invalidateQueries({ queryKey: ["mcp_hidden_counts"] });
      showToast.success(
        visibility === "hidden"
          ? "Hidden from MCP clients"
          : "Visible to MCP clients again"
      );
    },
    onError: (e: any) => {
      showToast.error(e.message ?? "Failed to update MCP visibility");
    },
  });
}

/**
 * Mark a contact (person) as sensitive. When sensitive:
 *  - The contact itself is redacted (only name/relationship exposed to MCP)
 *  - All notes/moments/action_items linked to this person are automatically
 *    hidden from MCP, without needing per-item toggles.
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
      qc.invalidateQueries({ queryKey: ["mcp_hidden_counts"] });
      showToast.success(
        isSensitive
          ? "Marked as sensitive — hidden from MCP clients"
          : "No longer sensitive — visible to MCP clients"
      );
    },
    onError: (e: any) => {
      showToast.error(e.message ?? "Failed to update sensitive flag");
    },
  });
}
