import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { callJson, corsHeaders, deductFixedCredits, ensureCredits, getAuthedAdmin, isUuid, jsonResponse, noteText } from "../_shared/group-ai.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { group_id } = await req.json().catch(() => ({}));
    if (!isUuid(group_id)) return jsonResponse({ error: "Invalid group_id" }, 400);
    const { userId, admin } = await getAuthedAdmin(req);
    const cost = await ensureCredits(admin, userId, "group_member_suggestions");

    const { data: group, error: groupError } = await admin.from("contact_groups").select("*").eq("id", group_id).eq("user_id", userId).maybeSingle();
    if (groupError) throw groupError;
    if (!group) return jsonResponse({ error: "Group not found" }, 404);

    const [{ data: memberships }, { data: contacts }, { data: notes }] = await Promise.all([
      admin.from("contact_group_memberships").select("person_id, contacts:person_id(name)").eq("group_id", group_id).eq("user_id", userId).is("archived_at", null),
      admin.from("contacts").select("id, name, company, role, tags, notes, metadata").eq("user_id", userId).is("merged_into", null).order("name"),
      admin.from("notes").select("title, content, metadata, created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(50),
    ]);
    const existingIds = new Set((memberships || []).map((m: any) => m.person_id));
    const candidates = (contacts || []).filter((contact: any) => !existingIds.has(contact.id));

    const result = await callJson([
      { role: "system", content: "Suggest contacts to add to this group. Return JSON: { suggestions: [{ contact_id, contact_name, reasoning, confidence }] }. Use only provided contact_id values. confidence is 0-1." },
      { role: "user", content: JSON.stringify({ group, existing_members: (memberships || []).map((m: any) => m.contacts?.name).filter(Boolean), candidates, recent_notes: (notes || []).map(noteText) }) },
    ]);
    const suggestions = Array.isArray(result.suggestions) ? result.suggestions : [];
    const candidateIds = new Set(candidates.map((contact: any) => contact.id));
    const rows = suggestions
      .filter((suggestion: any) => candidateIds.has(suggestion.contact_id) && Number(suggestion.confidence) > 0.6)
      .map((suggestion: any) => ({
        user_id: userId,
        suggestion_type: "group_member_suggestion",
        title: `Add ${suggestion.contact_name || "contact"} to ${group.name}`,
        description: suggestion.reasoning || null,
        confidence_score: Number(suggestion.confidence),
        target_entity_type: "contact_group",
        target_entity_id: group_id,
        payload: { group_id, contact_id: suggestion.contact_id, reasoning: suggestion.reasoning || "" },
        suppression_key: `group_member_suggestion:${group_id}:${suggestion.contact_id}`,
      }));

    if (rows.length > 0) {
      const { error: insertError } = await admin.from("review_queue").upsert(rows, { onConflict: "user_id,suggestion_type,title", ignoreDuplicates: true });
      if (insertError) throw insertError;
    }
    await deductFixedCredits(admin, userId, "group_member_suggestions", cost.tokens);
    return jsonResponse({ suggestions_added: rows.length });
  } catch (error) {
    console.error("suggest-group-members failed", error);
    const status = (error as { status?: number }).status || 500;
    return jsonResponse({ error: error instanceof Error ? error.message : "Failed to suggest members" }, status);
  }
});