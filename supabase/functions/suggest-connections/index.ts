import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  checkBalance,
  openRouterWithCredits,
  insufficientCreditsResponse,
  type CreditInfo,
} from "../_shared/llm-credits.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY")!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "unauthorized" }, 401);
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) return json({ error: "unauthorized" }, 401);

    const body = await req.json();
    const { note_id, mode } = body;

    if (mode === "daily") {
      // Daily discovery uses metadata matching only (no LLM calls, no credits needed)
      return await handleDailyDiscovery(user.id);
    }

    if (!note_id) return json({ error: "note_id or mode=daily required" }, 400);

    // Pre-check balance before LLM call
    const balance = await checkBalance(supabase, user.id);
    if (!balance.allowed) return insufficientCreditsResponse(corsHeaders);

    const { data: note } = await supabase
      .from("notes")
      .select("id, title, content, metadata, embedding")
      .eq("id", note_id)
      .eq("user_id", user.id)
      .single();

    if (!note) return json({ error: "Note not found" }, 404);

    const meta = (note.metadata || {}) as Record<string, unknown>;

    // Get existing manual links to exclude
    const { data: existingLinks } = await supabase
      .from("note_connections")
      .select("target_note_id")
      .eq("source_note_id", note_id)
      .eq("connection_type", "manual_link")
      .eq("user_id", user.id);

    const linkedIds = new Set((existingLinks || []).map((l: any) => l.target_note_id));

    // Get dismissed suggestions to exclude
    const { data: dismissed } = await supabase
      .from("dismissed_suggestions")
      .select("target_note_id")
      .eq("source_note_id", note_id)
      .eq("user_id", user.id);

    const dismissedIds = new Set((dismissed || []).map((d: any) => d.target_note_id));

    if (!note.embedding) return json({ suggestions: [] });

    const embedding = typeof note.embedding === "string" ? note.embedding : JSON.stringify(note.embedding);
    const { data: matches } = await supabase.rpc("match_notes", {
      query_embedding: embedding,
      match_threshold: 0.5,
      match_count: 15,
      p_user_id: user.id,
    });

    const candidates = (matches || [])
      .filter((m: any) => m.id !== note_id && !linkedIds.has(m.id) && !dismissedIds.has(m.id))
      .slice(0, 5);

    if (candidates.length === 0) return json({ suggestions: [] });

    // Build LLM prompt
    const candidateText = candidates.map((c: any, i: number) => {
      const cMeta = (c.metadata || {}) as Record<string, unknown>;
      return `${i + 1}. ID: ${c.id}
Title: "${c.title}"
Content snippet: ${(c.content || "").slice(0, 200)}
Topics: ${Array.isArray(cMeta.topics) ? (cMeta.topics as string[]).join(", ") : "none"}
People: ${Array.isArray(cMeta.people) ? (cMeta.people as string[]).join(", ") : "none"}
Similarity: ${(c.similarity * 100).toFixed(0)}%`;
    }).join("\n\n");

    const prompt = `You are analyzing connections between notes in a personal knowledge system.

CURRENT NOTE:
Title: "${note.title}"
Content: ${(note.content || "").slice(0, 500)}
Topics: ${Array.isArray(meta.topics) ? (meta.topics as string[]).join(", ") : "none"}
People: ${Array.isArray(meta.people) ? (meta.people as string[]).join(", ") : "none"}

CANDIDATE NOTES (potentially related):
${candidateText}

For each candidate, assess whether there is a meaningful connection to the current note.
Return a JSON array with objects containing:
- "note_id": the candidate note's ID
- "should_link": boolean — true if there's a genuine, useful connection
- "reason": 1 sentence explaining WHY these notes are connected (be specific, not generic)
- "suggested_context": a short phrase for how to reference this note (e.g., "related decision", "same project", "follow-up from")

Only return should_link: true for connections that would genuinely help the user.
Don't suggest links just because notes share a common word. The connection should be insightful.`;

    // LLM call with credit deduction
    const { result: llmData, credits } = await openRouterWithCredits(
      supabase, OPENROUTER_API_KEY, user.id, "suggest-connections:chat", "chat/completions",
      {
        model: "openai/gpt-4o-mini",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "You analyze note connections. Always respond with valid JSON containing a 'suggestions' array." },
          { role: "user", content: prompt },
        ],
      }
    );

    let suggestions: any[] = [];
    try {
      const parsed = JSON.parse(llmData.choices[0].message.content);
      suggestions = (parsed.suggestions || parsed).filter((s: any) => s.should_link);
    } catch {
      suggestions = [];
    }

    const enriched = suggestions.map((s: any) => {
      const candidate = candidates.find((c: any) => c.id === s.note_id);
      return {
        ...s,
        note_title: candidate?.title || "Unknown",
        similarity: candidate?.similarity || 0,
      };
    });

    return json({
      suggestions: enriched,
      credits: {
        remaining_tokens: credits.remaining_tokens,
        remaining_credits: credits.remaining_credits,
      },
    });
  } catch (err: any) {
    if (err.message === "INSUFFICIENT_CREDITS" || err.message === "NO_ACTIVE_PERIOD") {
      return insufficientCreditsResponse(corsHeaders);
    }
    console.error("suggest-connections error:", err);
    return json({ error: err.message }, 500);
  }
});

async function handleDailyDiscovery(userId: string) {
  // Daily discovery uses only embedding similarity + metadata matching — no LLM calls, no credit cost
  const { data: recentNotes } = await supabase
    .from("notes")
    .select("id, title, content, metadata, embedding")
    .eq("user_id", userId)
    .eq("is_trashed", false)
    .not("embedding", "is", null)
    .order("updated_at", { ascending: false })
    .limit(20);

  if (!recentNotes || recentNotes.length < 3) {
    return json({ discoveries: [], message: "Need more notes for daily discoveries." });
  }

  const { data: dismissed } = await supabase
    .from("dismissed_suggestions")
    .select("source_note_id, target_note_id")
    .eq("user_id", userId);

  const dismissedPairs = new Set(
    (dismissed || []).map((d: any) => `${d.source_note_id}:${d.target_note_id}`)
  );

  const dayIndex = Math.floor(Date.now() / (24 * 60 * 60 * 1000));
  const startIdx = dayIndex % Math.max(1, recentNotes.length - 3);
  const anchors = recentNotes.slice(startIdx, startIdx + 3);
  const discoveries: any[] = [];

  for (const anchor of anchors) {
    if (!anchor.embedding) continue;
    const embedding = typeof anchor.embedding === "string" ? anchor.embedding : JSON.stringify(anchor.embedding);

    const { data: matches } = await supabase.rpc("match_notes", {
      query_embedding: embedding,
      match_threshold: 0.55,
      match_count: 5,
      p_user_id: userId,
    });

    const candidates = (matches || []).filter((m: any) => {
      if (m.id === anchor.id) return false;
      if (dismissedPairs.has(`${anchor.id}:${m.id}`) || dismissedPairs.has(`${m.id}:${anchor.id}`)) return false;
      return true;
    });

    if (candidates.length > 0) {
      const best = candidates[0];
      const anchorMeta = (anchor.metadata || {}) as Record<string, unknown>;
      const bestMeta = (best.metadata || {}) as Record<string, unknown>;

      const sharedTopics = (Array.isArray(anchorMeta.topics) && Array.isArray(bestMeta.topics))
        ? (anchorMeta.topics as string[]).filter(t =>
            (bestMeta.topics as string[]).some(bt => bt.toLowerCase() === t.toLowerCase())
          )
        : [];

      const sharedPeople = (Array.isArray(anchorMeta.people) && Array.isArray(bestMeta.people))
        ? (anchorMeta.people as string[]).filter(p =>
            (bestMeta.people as string[]).some(bp => bp.toLowerCase() === p.toLowerCase())
          )
        : [];

      let reason = `${(best.similarity * 100).toFixed(0)}% similar`;
      if (sharedTopics.length > 0) reason += `, shared topics: ${sharedTopics.join(", ")}`;
      if (sharedPeople.length > 0) reason += `, shared people: ${sharedPeople.join(", ")}`;

      discoveries.push({
        source_note_id: anchor.id,
        source_note_title: anchor.title,
        target_note_id: best.id,
        target_note_title: best.title,
        similarity: best.similarity,
        reason,
      });
    }
  }

  return json({ discoveries: discoveries.slice(0, 5) });
}
