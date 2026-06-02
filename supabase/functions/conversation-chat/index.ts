import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveSystemPrompt } from "../_shared/llm-router.ts";
import { CONVERSATION_CHAT_PROMPT } from "../_shared/llm-defaults.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

type Attachment = { name: string; content: string };
type ConversationContext = { context?: string; intent?: string; presetTone?: string; customTone?: string };

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { message, personId, conversationContext, attachments } = await req.json();
    if (!message || typeof message !== "string") return json({ error: "message required" }, 400);
    if (personId && typeof personId !== "string") return json({ error: "personId must be a string" }, 400);

    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: { user }, error: userError } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
    if (userError || !user) return json({ error: "Unauthorized" }, 401);

    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) throw new Error("LOVABLE_API_KEY not configured");

    const [historyResult, personResult, profileResult, notesResult, momentsResult, shortDocsResult] = await Promise.all([
      supabase.from("conversation_messages").select("role, content").eq("user_id", user.id).eq("person_id", personId).order("created_at", { ascending: false }).limit(10),
      personId ? supabase.from("contacts").select("id, name, notes, tags, aliases, metadata").eq("user_id", user.id).eq("id", personId).single() : Promise.resolve({ data: null }),
      personId ? supabase.from("profile_entries").select("label, value, profile_categories(name)").eq("user_id", user.id).eq("contact_id", personId).limit(50) : Promise.resolve({ data: [] }),
      supabase.from("notes").select("title, created_at, metadata").eq("user_id", user.id).eq("is_trashed", false).eq("ai_visibility", "visible").order("created_at", { ascending: false }).limit(50),
      supabase.from("moments").select("title, description, happened_at, impact_level, status").eq("user_id", user.id).is("deleted_at", null).order("happened_at", { ascending: false }).limit(50),
      personId ? supabase.from("person_documents").select("title, content").eq("user_id", user.id).eq("person_id", personId).eq("memory_type", "short_term") : Promise.resolve({ data: [] }),
    ]);

    const person = personResult.data as any;
    if (personId && !person) return json({ error: "Person not found" }, 404);

    const aliases = [person?.name, ...(person?.aliases || [])].filter(Boolean).map((n: string) => n.toLowerCase());
    const relatedNotes = (notesResult.data || []).filter((note: any) => {
      const people = note.metadata?.people;
      return Array.isArray(people) && aliases.some((name: string) => people.some((p: string) => String(p).toLowerCase() === name));
    }).slice(0, 10);
    const relatedMoments = (momentsResult.data || []).filter((m: any) => {
      const text = `${m.title || ""} ${m.description || ""}`.toLowerCase();
      return aliases.some((name: string) => text.includes(name));
    }).slice(0, 10);

    let longTermContext = "";
    if (personId) longTermContext = await searchLongTermMemory(supabase, apiKey, message, personId, user.id);

    const personContext = [
      buildPersonContext(person, profileResult.data || [], relatedNotes, relatedMoments),
      buildShortTermMemoryContext(shortDocsResult.data || []),
      longTermContext,
      buildAttachmentContext(attachments),
      buildConversationContext(conversationContext),
    ].filter(Boolean).join("\n\n");

    const systemPrompt = await resolveSystemPrompt(
      supabase,
      "conversation-chat.main",
      CONVERSATION_CHAT_PROMPT,
      { personContext },
    );

    const history = (historyResult.data || []).reverse().map((m: any) => ({ role: m.role, content: m.content }));
    const gatewayResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [{ role: "system", content: systemPrompt }, ...history, { role: "user", content: message }],
      }),
    });

    if (!gatewayResponse.ok) {
      if (gatewayResponse.status === 429) return json({ error: "Rate limit hit — try again shortly." }, 429);
      if (gatewayResponse.status === 402) return json({ error: "AI usage limit reached. Add credits in Settings → Workspace → Usage." }, 402);
      return json({ error: `AI request failed (${gatewayResponse.status})` }, 500);
    }

    const gatewayData = await gatewayResponse.json();
    const reply = gatewayData.choices?.[0]?.message?.content || "I couldn't generate a reply.";

    if (personId) {
      await supabase.from("conversation_messages").insert([
        { user_id: user.id, person_id: personId, role: "user", content: message },
        { user_id: user.id, person_id: personId, role: "assistant", content: reply },
      ]);
    }

    return json({ reply });
  } catch (error) {
    console.error("conversation-chat error:", error);
    return json({ error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});

function buildPersonContext(person: any, profileEntries: any[], notes: any[], moments: any[]) {
  if (!person) return "";
  let ctx = `## Person Context\nName: ${person.name}\n`;
  if (person.aliases?.length) ctx += `Aliases: ${person.aliases.join(", ")}\n`;
  if (person.tags?.length) ctx += `Tags: ${person.tags.join(", ")}\n`;
  if (person.notes) ctx += `Notes: ${person.notes}\n`;
  if (profileEntries.length) {
    ctx += "\n### Profile\n";
    for (const entry of profileEntries) ctx += `- ${entry.profile_categories?.name || "Profile"}: ${entry.label} — ${entry.value}\n`;
  }
  if (moments.length) {
    ctx += "\n### Related Moments\n";
    for (const m of moments) ctx += `- ${m.happened_at}: ${m.title}${m.description ? ` — ${m.description}` : ""}\n`;
  }
  if (notes.length) {
    ctx += "\n### Related Notes\n";
    for (const n of notes) ctx += `- ${n.title} (${n.created_at})\n`;
  }
  return ctx;
}

function buildShortTermMemoryContext(docs: { title: string; content: string }[]) {
  const usable = docs.filter((d) => d.content?.trim());
  if (!usable.length) return "";
  return "## Short-term Memory\n" + usable.map((d) => `### ${d.title || "Note"}\n${d.content}`).join("\n\n");
}

function buildAttachmentContext(attachments?: Attachment[]) {
  if (!Array.isArray(attachments) || !attachments.length) return "";
  return "## Attachments\n" + attachments.map((a) => `### ${a.name}\n\`\`\`\n${String(a.content || "").slice(0, 50000)}\n\`\`\``).join("\n\n");
}

function buildConversationContext(ctx?: ConversationContext) {
  if (!ctx || (!ctx.context && !ctx.intent && !ctx.presetTone && !ctx.customTone)) return "";
  let out = "## Conversation Preparation\n";
  if (ctx.context) out += `Context:\n${ctx.context}\n`;
  if (ctx.intent) out += `Intent:\n${ctx.intent}\n`;
  const tones = [ctx.presetTone, ctx.customTone].filter(Boolean).join(", ");
  if (tones) out += `Tone guidance: ${tones}\n`;
  return out;
}

async function searchLongTermMemory(supabase: any, apiKey: string, query: string, personId: string, userId: string) {
  try {
    const embedding = await generateEmbedding(apiKey, query);
    const { data, error } = await supabase.rpc("match_person_documents", {
      query_embedding: JSON.stringify(embedding),
      match_person_id: personId,
      match_user_id: userId,
      match_threshold: 0.3,
      match_count: 5,
    });
    if (error || !data?.length) return "";
    return "## Relevant Long-term Memory\n" + data.map((d: any) => `### ${d.title}\n${d.content}`).join("\n\n");
  } catch (error) {
    console.error("long-term memory search failed:", error);
    return "";
  }
}

async function generateEmbedding(apiKey: string, text: string): Promise<number[]> {
  const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash-lite",
      temperature: 0,
      messages: [{ role: "user", content: `Generate a 768-dimensional semantic embedding vector for this text:\n\n${text.substring(0, 2000)}` }],
      tools: [{ type: "function", function: { name: "store_embedding", description: "Store the embedding vector", parameters: { type: "object", properties: { embedding: { type: "array", items: { type: "number" } } }, required: ["embedding"], additionalProperties: false } } }],
      tool_choice: { type: "function", function: { name: "store_embedding" } },
    }),
  });
  if (!response.ok) throw new Error(`Embedding generation failed: ${response.status}`);
  const data = await response.json();
  const args = JSON.parse(data.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments || "{}");
  let embedding = Array.isArray(args.embedding) ? args.embedding : [];
  embedding = embedding.slice(0, 768).map((v: unknown) => Number(v) || 0);
  while (embedding.length < 768) embedding.push(0);
  const magnitude = Math.sqrt(embedding.reduce((sum: number, v: number) => sum + v * v, 0));
  return magnitude > 0 ? embedding.map((v: number) => v / magnitude) : embedding;
}
