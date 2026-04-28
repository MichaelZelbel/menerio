import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { callMarkdown, corsHeaders, deductFixedCredits, ensureCredits, getAuthedAdmin, isUuid, jsonResponse } from "../_shared/group-ai.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { group_id, period_days = 7 } = await req.json().catch(() => ({}));
    if (!isUuid(group_id)) return jsonResponse({ error: "Invalid group_id" }, 400);
    const days = Math.min(90, Math.max(1, Number(period_days) || 7));
    const { userId, admin } = await getAuthedAdmin(req);
    const cost = await ensureCredits(admin, userId, "group_briefing");

    const { data: group, error: groupError } = await admin.from("contact_groups").select("*").eq("id", group_id).eq("user_id", userId).maybeSingle();
    if (groupError) throw groupError;
    if (!group) return jsonResponse({ error: "Group not found" }, 404);

    const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
    const [{ data: memberships }, { data: interactions }, { data: actions }] = await Promise.all([
      admin.from("contact_group_memberships").select("*, contacts:person_id(name, company, role)").eq("group_id", group_id).eq("user_id", userId).is("archived_at", null).order("last_movement_at", { ascending: true }),
      admin.from("contact_interactions").select("interaction_date, type, summary, contact_id, group_id").eq("user_id", userId).eq("group_id", group_id).gte("interaction_date", since).order("interaction_date", { ascending: false }),
      admin.from("action_items").select("content, status, priority, due_date, contact_id, metadata").eq("user_id", userId).eq("metadata->>group_id", group_id).order("created_at", { ascending: false }),
    ]);

    const briefing = await callMarkdown([
      { role: "system", content: "Generate a concise weekly group briefing in Markdown with these exact sections: ## Movement, ## Stale Members, ## Top Priorities for Next Week, ## Goals Progress. Ground every claim in provided data." },
      { role: "user", content: JSON.stringify({ group, period_days: days, memberships: memberships || [], interactions: interactions || [], action_items: actions || [] }) },
    ]);

    const generatedAt = new Date().toISOString();
    const { error: insertError } = await admin.from("group_briefings").insert({
      user_id: userId,
      group_id,
      period_days: days,
      briefing_markdown: briefing,
      generated_at: generatedAt,
    });
    if (insertError) throw insertError;
    await deductFixedCredits(admin, userId, "group_briefing", cost.tokens);
    return jsonResponse({ briefing_markdown: briefing, generated_at: generatedAt });
  } catch (error) {
    console.error("generate-group-briefing failed", error);
    const status = (error as { status?: number }).status || 500;
    return jsonResponse({ error: error instanceof Error ? error.message : "Failed to generate briefing" }, status);
  }
});