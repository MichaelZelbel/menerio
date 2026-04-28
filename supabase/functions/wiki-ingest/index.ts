import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;
const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY")!;
const OPENROUTER_MODEL = "openai/gpt-4o-mini";

type WikiAction = {
  op: "create" | "update";
  slug: string;
  title?: string;
  page_type?: string;
  summary?: string;
  content?: string;
  patch?: string;
  change_summary?: string;
};

type SynthesisResult = {
  actions: WikiAction[];
  source_links: Array<{ note_id: string; page_slugs: string[] }>;
  log_summary: string;
};

const WIKI_SYNTHESIS_AGENT_PROMPT = `=== BEGIN WIKI SYNTHESIS AGENT PROMPT ===

You are the Lexicon maintainer for a personal LLM-maintained knowledge base. Your job is to read one new note the user has captured (or updated) and decide how to update the Lexicon — creating new pages, updating existing pages, and maintaining cross-references.

# Editorial policy

Page types you may use, exclusively:

- entity: a named thing — an organization, place, product, project, event, work

- concept: an idea, theory, framework, or abstract topic

- source: a summary of a single notable note or external article (use sparingly — most notes don't need their own source page)

- overview: a high-level synthesis covering a domain, with links to its constituent entities and concepts

- synthesis: an analysis or comparison drawing across multiple entities or concepts

- person: a specific named person the user interacts with or writes about

Conventions:

- Slugs are lowercase kebab-case, derived from the title. Stable: never rename an existing slug. When updating an existing page, use the slug exactly as it appears in the index.

- Every page begins with a one-paragraph summary at the top, before any headers.

- Write pages in readable Markdown, not as one long block. Use short paragraphs separated by blank lines. For every non-trivial page, include 2–4 useful sections such as "## What this means", "## Known facts", "## Open questions", "## Related", or a more specific heading. Prefer concise bullets for lists of facts, relationships, or decisions.

- Lexicon links use [[slug]] syntax. Use them generously: every named entity, concept, and person mentioned should be linked, whether or not the target page exists yet. The system tracks unresolved links separately.

- Do not use markdown link syntax for internal pages.

- When updating a page, return the FULL new markdown content in the patch field, not a diff. The system replaces the page body wholesale.

- When the new note contradicts something on an existing page, do not silently overwrite. Add or extend a "## Contradictions" section on that page, with the date and the conflicting claims. The user reviews contradictions in the review list.

- When two pages would say nearly the same thing, prefer one canonical page and link to it from the other.

- Be honest about uncertainty. If the note is ambiguous, say so on the page rather than picking a confident reading.

- Do not invent facts. Only write claims supported by the note you are reading or by content already on existing pages. If you find yourself wanting to add color or context that isn't grounded, stop.

- For every page you create or update, include the note_id in source_links so the user can trace the claim.

# Existing Lexicon pages (index)

Here is the current index of Lexicon pages. One per line: slug | title | page_type | summary.

[EXISTING_PAGES_INDEX_HERE]

# The new note

The new note follows this system prompt as the user-role message. It includes the note_id, the title, and the content as plain text.

# Your job

Read the note. Decide:

1. What named entities, concepts, and people are mentioned? Each is a candidate for a page.

2. For each candidate, does a page already exist (check the index)? If yes, update it to incorporate the new information. If no, create a new page.

3. What cross-references need to be added or strengthened? Add [[slug]] wikilinks generously.

4. Does the note contradict anything on existing pages? If so, add a "## Contradictions" section on the affected page.

5. Should an overview or synthesis page be updated to reflect new entities or themes?

If the note contains nothing Lexicon-worthy (a shopping list, a passing thought, a one-line reminder), return an empty actions array. Not every note becomes a Lexicon update.

# Output

Return ONLY a JSON object, no surrounding text, no markdown code fences:

{

  "actions": [

    {

      "op": "create",

      "slug": "kebab-case-slug",

      "title": "Title",

      "page_type": "entity|concept|source|overview|synthesis|person|group",

      "summary": "One-line summary that will appear in the index.",

      "content": "Full markdown content of the new page. Starts with the summary paragraph. Uses [[slug]] for wikilinks.",

      "change_summary": "Short past-tense description for the activity feed: e.g. 'Created from note about Sarah Chen'."

    },

    {

      "op": "update",

      "slug": "existing-slug",

      "title": "Updated title (only include if changing)",

      "page_type": "Updated page_type (only include if changing)",

      "summary": "Updated summary (only include if changing)",

      "patch": "FULL new markdown content of the page after your edits. Not a diff — the whole page.",

      "change_summary": "Short past-tense description: e.g. 'Added contradiction note about Sarah's role'."

    }

  ],

  "source_links": [

    {

      "note_id": "uuid-of-the-note-being-ingested",

      "page_slugs": ["slug-of-page-this-note-supports", "another-slug"]

    }

  ],

  "log_summary": "One-line description of what happened in this ingest, written for the user. Example: 'Created sarah-chen and ml-team-migration; updated platform-migration with contradiction note.'"

}

If the note has no Lexicon-worthy content:

{ "actions": [], "source_links": [], "log_summary": "Note had no Lexicon-worthy content." }

=== END WIKI SYNTHESIS AGENT PROMPT ===`;

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function extractBearer(req: Request): string | null {
  const header = req.headers.get("Authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1] || null;
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function tiptapJsonToText(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const current = node as { type?: string; text?: string; content?: unknown[]; attrs?: Record<string, unknown> };
  if (current.type === "text") return current.text || "";
  if (current.type === "hardBreak") return "\n";
  if (current.type === "wikilink") return `[[${current.attrs?.noteTitle || current.attrs?.slug || ""}]]`;
  const children = Array.isArray(current.content) ? current.content.map(tiptapJsonToText).join("") : "";
  if (["paragraph", "heading", "blockquote", "listItem", "taskItem"].includes(current.type || "")) return `${children}\n`;
  return children;
}

function noteContentToText(content: unknown): string {
  if (typeof content !== "string") return "";
  const trimmed = content.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return tiptapJsonToText(JSON.parse(trimmed)).replace(/\n{3,}/g, "\n\n").trim();
    } catch {
      return trimmed;
    }
  }
  return trimmed
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractJson(raw: string): SynthesisResult {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) throw new Error("No JSON object found in model response");
  const parsed = JSON.parse(cleaned.slice(start, end + 1));
  if (!Array.isArray(parsed.actions) || !Array.isArray(parsed.source_links) || typeof parsed.log_summary !== "string") {
    throw new Error("Model response does not match required shape");
  }
  return parsed as SynthesisResult;
}

function normalizeResult(result: SynthesisResult, noteId: string): SynthesisResult {
  const allowedTypes = new Set(["entity", "concept", "source", "overview", "synthesis", "person", "group"]);
  const actions = result.actions
    .filter((action) => (action.op === "create" || action.op === "update") && typeof action.slug === "string")
    .map((action) => ({
      ...action,
      slug: action.slug.toLowerCase().trim().replace(/[^a-z0-9-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, ""),
      page_type: action.page_type && allowedTypes.has(action.page_type) ? action.page_type : undefined,
    }))
    .filter((action) => action.slug && (action.content || action.patch));

  const source_links = result.source_links
    .filter((link) => link.note_id === noteId && Array.isArray(link.page_slugs))
    .map((link) => ({
      note_id: noteId,
      page_slugs: [...new Set(link.page_slugs.map((slug) => String(slug).toLowerCase().trim()).filter(Boolean))],
    }));

  return { actions, source_links, log_summary: result.log_summary || "Lexicon ingest completed." };
}

async function logWiki(db: any, userId: string, operation: string, details: Record<string, unknown>) {
  const { error } = await db.from("wiki_log").insert({ user_id: userId, operation, details });
  if (error) console.error("wiki_log insert failed", error);
}

async function callSynthesis(systemPrompt: string, userContent: string): Promise<{ raw: string; usage?: Record<string, unknown> }> {
  if (!OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY is not configured");
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
      temperature: 0.2,
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`OpenRouter failed: ${response.status} ${text}`);
  }

  const data = await response.json();
  return { raw: data.choices?.[0]?.message?.content || "", usage: data.usage };
}

function replaceInsightsSection(content: string, nextSection: string) {
  const normalized = content.trimEnd();
  const section = `## Insights\n${nextSection.trimEnd()}\n`;
  const insightsBlock = /(^|\n)## Insights\n[\s\S]*?(?=\n##\s|$)/;
  if (insightsBlock.test(normalized)) return normalized.replace(insightsBlock, `$1${section}`).trimEnd() + "\n";
  return `${normalized}\n\n${section}`.trimEnd() + "\n";
}

function extractPeopleFromMetadata(metadata: unknown): string[] {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return [];
  const people = (metadata as { people?: unknown }).people;
  const values = Array.isArray(people) ? people : typeof people === "string" ? [people] : [];
  return [...new Set(values.map((value) => String(value).trim()).filter(Boolean))];
}

async function synthesizeGroupInsights(db: any, userId: string, note: any, noteId: string, contentText: string) {
  const people = extractPeopleFromMetadata(note.metadata);
  if (people.length === 0) return { updated: 0, skipped: "no_people_metadata" };

  const { data: contacts, error: contactsError } = await db
    .from("contacts")
    .select("id, name")
    .in("name", people);
  if (contactsError) throw contactsError;
  const personIds = [...new Set((contacts || []).map((contact: any) => contact.id))];
  if (personIds.length === 0) return { updated: 0, skipped: "no_matching_contacts" };

  const { data: memberships, error: membershipsError } = await db
    .from("contact_group_memberships")
    .select("group_id, person_id, contact_groups:group_id(id, slug, name)")
    .in("person_id", personIds)
    .is("archived_at", null);
  if (membershipsError) throw membershipsError;

  const groups = new Map<string, { id: string; slug: string; name: string; personIds: Set<string> }>();
  for (const membership of memberships || []) {
    const group = membership.contact_groups;
    if (!group?.id || !group?.slug) continue;
    const current = groups.get(group.id) || { id: group.id, slug: group.slug, name: group.name || group.slug, personIds: new Set<string>() };
    current.personIds.add(membership.person_id);
    groups.set(group.id, current);
  }
  if (groups.size === 0) return { updated: 0, skipped: "no_groups" };

  let updated = 0;
  const cutoff = Date.now() - 5 * 60 * 1000;
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  for (const group of groups.values()) {
    const { data: page, error: pageError } = await db
      .from("wiki_pages")
      .select("id, slug, title, content, last_synthesized_at")
      .eq("slug", `group-${group.slug}`)
      .eq("page_type", "group")
      .maybeSingle();
    if (pageError) throw pageError;
    if (!page) continue;
    if (page.last_synthesized_at && new Date(page.last_synthesized_at).getTime() > cutoff) continue;

    const { data: interactions, error: interactionsError } = await db
      .from("contact_interactions")
      .select("interaction_date, type, summary, action_items, contact_id")
      .in("contact_id", Array.from(group.personIds))
      .gte("interaction_date", since)
      .order("interaction_date", { ascending: false })
      .limit(50);
    if (interactionsError) throw interactionsError;

    const { data: recentNotes, error: recentNotesError } = await db
      .from("notes")
      .select("id, title, content, metadata, created_at")
      .gte("created_at", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
      .order("created_at", { ascending: false })
      .limit(100);
    if (recentNotesError) throw recentNotesError;
    const noteExcerpts = (recentNotes || [])
      .filter((candidate: any) => extractPeopleFromMetadata(candidate.metadata).some((person) => people.includes(person)))
      .slice(0, 12)
      .map((candidate: any) => `- ${candidate.title || "Untitled"}: ${noteContentToText(candidate.content).slice(0, 500)}`)
      .join("\n") || "None";

    const context = [
      `Group: ${group.name}`,
      `Mentioned people: ${people.join(", ")}`,
      `Current note excerpt:\n${contentText.slice(0, 2500)}`,
      `Recent interactions:\n${(interactions || []).map((item: any) => `- ${item.interaction_date} ${item.type}: ${item.summary || ""}`).join("\n") || "None"}`,
      `Related note excerpts from the last 30 days:\n${noteExcerpts}`,
      `Existing page content:\n${page.content}`,
    ].join("\n\n");

    const { raw } = await callSynthesis(
      "You rewrite only the Insights section for a group Lexicon page. Return JSON only: {\"insights\": \"Markdown body for the Insights section, without the ## Insights heading\"}. Do not alter Purpose or Members. Do not invent facts.",
      context,
    );
    const parsed = JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, ""));
    const insights = typeof parsed.insights === "string" && parsed.insights.trim() ? parsed.insights : "_No synthesized insights yet._";
    const nextContent = replaceInsightsSection(page.content || "", insights);

    const { error: revisionError } = await db.from("wiki_revisions").insert({
      user_id: userId,
      wiki_page_id: page.id,
      page_slug: page.slug,
      page_title: page.title,
      change_type: "updated",
      previous_content: page.content,
      new_content: nextContent,
      source_note_id: noteId,
      change_summary: "Updated group insights from recent member context",
      status: "applied",
    });
    if (revisionError) throw revisionError;

    const { error: updateError } = await db
      .from("wiki_pages")
      .update({ content: nextContent, last_synthesized_at: new Date().toISOString() })
      .eq("id", page.id);
    if (updateError) throw updateError;
    const { error: sourceError } = await db
      .from("wiki_page_sources")
      .upsert({ user_id: userId, wiki_page_id: page.id, note_id: noteId }, { onConflict: "wiki_page_id,note_id" });
    if (sourceError) throw sourceError;
    updated += 1;
  }

  return { updated };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const startedAt = Date.now();
  let db: any = null;
  let userId: string | null = null;
  let noteId: string | null = null;

  try {
    const token = extractBearer(req);
    if (!token) return jsonResponse({ error: "Unauthenticated" }, 401);

    const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { data: userData, error: userError } = await authClient.auth.getUser(token);
    if (userError || !userData.user) return jsonResponse({ error: "Unauthenticated" }, 401);
    userId = userData.user.id;

    db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const body = await req.json().catch(() => ({}));
    noteId = body.note_id;
    const changeType = body.change_type;
    if (!isUuid(noteId) || !["INSERT", "UPDATE"].includes(changeType)) {
      return jsonResponse({ error: "Invalid request body" }, 400);
    }

    const { data: note, error: noteError } = await db
      .from("notes")
      .select("id, title, content, metadata")
      .eq("id", noteId)
      .maybeSingle();

    if (noteError) throw noteError;
    if (!note) {
      await logWiki(db, userId, "ingest_skipped", { reason: "note_not_found", note_id: noteId });
      return jsonResponse({ skipped: true, reason: "note_not_found" });
    }

    const contentText = noteContentToText(note.content);
    const meaningfulText = `${note.title || ""}\n${contentText}`.replace(/\s+/g, " ").trim();
    if (meaningfulText.length < 20) {
      await logWiki(db, userId, "ingest_skipped", { reason: "note_too_short", note_id: noteId });
      return jsonResponse({ skipped: true, reason: "note_too_short" });
    }

    const { data: existingPages, error: pagesError } = await db
      .from("wiki_pages")
      .select("id, slug, title, page_type, summary")
      .order("page_type", { ascending: true })
      .order("title", { ascending: true });
    if (pagesError) throw pagesError;

    const index = (existingPages || [])
      .map((page: any) => `${page.slug} | ${page.title} | ${page.page_type} | ${page.summary || ""}`)
      .join("\n") || "No existing pages yet.";

    const systemPrompt = WIKI_SYNTHESIS_AGENT_PROMPT.replace("[EXISTING_PAGES_INDEX_HERE]", index);
    const userMessage = `note_id: ${noteId}\n\n# ${note.title || "Untitled"}\n\n${contentText}`;

    const { raw } = await callSynthesis(systemPrompt, userMessage);
    let parsed: SynthesisResult;
    try {
      parsed = normalizeResult(extractJson(raw), noteId);
    } catch (parseError) {
      await logWiki(db, userId, "ingest_failed", {
        note_id: noteId,
        reason: "parse_failed",
        raw_response: raw,
        error: parseError instanceof Error ? parseError.message : String(parseError),
      });
      return jsonResponse({ error: "Failed to parse wiki synthesis response" }, 500);
    }

    const { data: applyResult, error: applyError } = await db.rpc("wiki_apply_ingest", {
      p_note_id: noteId,
      p_actions: parsed.actions,
      p_source_links: parsed.source_links,
    });
    if (applyError) throw applyError;

    const groupInsightsResult = changeType === "UPDATE"
      ? await synthesizeGroupInsights(db, userId, note, noteId, contentText)
      : { updated: 0, skipped: "not_update" };

    const durationMs = Date.now() - startedAt;
    await logWiki(db, userId, "ingest", {
      note_id: noteId,
      change_type: changeType,
      action_count: parsed.actions.length,
      log_summary: parsed.log_summary,
      duration_ms: durationMs,
      apply_result: applyResult,
      group_insights: groupInsightsResult,
    });

    return jsonResponse({ ok: true, summary: parsed.log_summary, action_count: parsed.actions.length, group_insights: groupInsightsResult, duration_ms: durationMs });
  } catch (error) {
    console.error("wiki-ingest failed", error);
    if (db && userId) {
      await logWiki(db, userId, "ingest_failed", {
        note_id: noteId,
        error: error instanceof Error ? error.message : String(error),
        duration_ms: Date.now() - startedAt,
      }).catch((logError: unknown) => console.error("failed to log wiki ingest failure", logError));
    }
    return jsonResponse({ error: "Lexicon ingest failed" }, 500);
  }
});

// TODO: Add a wiki_ingest_jobs queue table later if duplicate work becomes a problem.
