import { supabase } from "@/integrations/supabase/client";

export interface ModerationResult {
  approved: boolean;
  reason?: string;
  category?: string;
  support_hint?: string;
}

export async function moderateContent(
  contentFields: Record<string, string | null | undefined>,
  action: "share_note",
  itemType: "note",
  itemId?: string
): Promise<ModerationResult> {
  try {
    const cleanFields: Record<string, string> = {};
    for (const [key, val] of Object.entries(contentFields)) {
      if (val) cleanFields[key] = val;
    }

    const { data, error } = await supabase.functions.invoke("moderate-content", {
      body: {
        content_fields: cleanFields,
        action,
        item_type: itemType,
        item_id: itemId,
      },
    });

    if (error) {
      console.warn("[Moderation] Edge function error — failing open:", error);
      return { approved: true };
    }

    if (!data || typeof data.approved === "undefined") {
      console.warn("[Moderation] Unexpected response — failing open:", data);
      return { approved: true };
    }

    return data as ModerationResult;
  } catch (err) {
    console.warn("[Moderation] Network error — failing open:", err);
    return { approved: true };
  }
}
