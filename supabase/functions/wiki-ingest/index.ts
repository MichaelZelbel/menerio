import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;
const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY")!;
const OPENROUTER_MODEL = "google/gemini-2.5-flash";

// Maximum % of existing content that an update may delete before we reject it as drift.
const MAX_DELETION_RATIO = 0.4;
// Maximum number of new wikilinks an action may introduce that aren't grounded in the note.
const MAX_UNGROUNDED_NEW_LINKS = 0;

const INTRO_SLUG = "__intro__";

function slugifyHeading(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "section";
}

type WikiSection = { slug: string; heading: string; body: string };

function parseSections(markdown: string): WikiSection[] {
  const text = (markdown || "").replace(/\r\n/g, "\n");
  const sections: WikiSection[] = [];
  let current: WikiSection = { slug: INTRO_SLUG, heading: "", body: "" };
  const buf: string[] = [];
  const flush = () => {
    current.body = buf.join("\n").replace(/\n+$/, "");
    if (current.slug !== INTRO_SLUG || current.body.trim().length > 0) sections.push(current);
    buf.length = 0;
  };
  for (const line of text.split("\n")) {
    const m = line.match(/^##\s+(.+?)\s*$/);
    if (m) {
      flush();
      current = { slug: slugifyHeading(m[1].trim()), heading: m[1].trim(), body: "" };
    } else {
      buf.push(line);
    }
  }
  flush();
  return sections;
}

function mergeWithProtectedSections(current: string, proposed: string, protectedSlugs: string[]): string {
  const protectedSet = new Set(protectedSlugs);
  const currentBySlug = new Map(parseSections(current).map((s) => [s.slug, s]));
  const proposedSections = parseSections(proposed);
  const out: WikiSection[] = [];
  const seen = new Set<string>();
  for (const section of proposedSections) {
    seen.add(section.slug);
    if (protectedSet.has(section.slug) && currentBySlug.has(section.slug)) {
      out.push(currentBySlug.get(section.slug)!);
    } else {
      out.push(section);
    }
  }
  for (const slug of protectedSlugs) {
    if (!seen.has(slug) && currentBySlug.has(slug)) {
      out.push(currentBySlug.get(slug)!);
      seen.add(slug);
    }
  }
  const parts: string[] = [];
  for (const s of out) {
    if (s.slug === INTRO_SLUG) {
      if (s.body.trim()) parts.push(s.body.trim());
    } else {
      parts.push(`## ${s.heading}\n${s.body}`.trimEnd());
    }
  }
  return parts.join("\n\n").trim() + "\n";
}

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

You are the Lexicon maintainer for a personal knowledge base. You read ONE new note the user just captured or updated, and decide whether and how to update the Lexicon.

# The most important rule: GROUND EVERY CLAIM AND EVERY LINK

The Lexicon is failing because past synthesis runs invented relationships and added wikilinks that have nothing to do with the note. You must not do that.

For every sentence you write and every \`[[slug]]\` you add, ask yourself:
"Is this claim or this link DIRECTLY supported by the text of this note (or, for an update, by content already on the existing page)?"

If the answer is "no" or "I'm filling in context from world knowledge" — DO NOT WRITE IT.

# Never update a page about a different subject

An \`update\` is only allowed if the page's exact subject (its title, or the words in its slug) is named in the note. Do not update a page just because the note's topic is in the same category. Two different AI agents, two different companies, two different products, two different people with similar roles are SEPARATE pages — even if they do similar things. If the note describes a new entity that doesn't have a page yet, prefer \`create\` (or do nothing) over twisting an existing page to fit. When in doubt, return empty actions.

Concretely:

- DO NOT add a wikilink to an entity, person, organization, product, place, or concept just because it is topically related. Only link to things that are explicitly named in the note (or already on the page you are updating).
- DO NOT add "is integrated with X", "works at Y", "is a member of Z" unless the note says so in plain words.
- DO NOT add background context, history, or framing that isn't in the note. The Lexicon is a record of what the user has captured, not an encyclopedia.
- When in doubt, write LESS. An empty actions array is a perfectly good answer.

# Page types

Use exactly one of: \`entity\`, \`concept\`, \`source\`, \`overview\`, \`synthesis\`, \`person\`, \`group\`.

# Conventions

- Slugs are lowercase kebab-case. Stable. Never rename an existing slug. For updates, copy the slug exactly from the index.
- Every page begins with one short paragraph summary, then sections.
- Use short paragraphs and 2–4 sections like "## Known facts", "## Open questions", "## Related". Keep it readable.
- Wikilinks use \`[[slug]]\` syntax. Be SPARING. Maximum 5 wikilinks per page action, and only for things explicitly named in the note.
- For an UPDATE, return the FULL new markdown of the page in \`patch\`. Do not delete or rewrite existing sections unless the note clearly invalidates them. Prefer ADDITIVE updates: append a new bullet under "## Known facts", or add a "## Contradictions" section. Preserve everything else verbatim.
- If the note contradicts the existing page, do NOT silently overwrite. Add a "## Contradictions" section with date and the conflicting claims.
- Do not invent facts. If the note is ambiguous, say so on the page rather than picking a confident reading.
- For every page you create or update, include the note_id in source_links.

# When to do nothing

Most notes do NOT need a Lexicon update. Return an empty actions array if:
- The note is short, vague, a reminder, a shopping list, a passing thought.
- The note is a transcript or chat log without clear new facts about a named entity.
- The note only restates things already on existing pages.
- The note mentions things in passing without saying anything substantive about them.

# Existing Lexicon pages (index)

slug | title | page_type | summary

[EXISTING_PAGES_INDEX_HERE]

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
      "content": "Full markdown content. Starts with the summary paragraph. Uses [[slug]] sparingly and only for things named in the note.",
      "change_summary": "Short past-tense description: e.g. 'Created from note about Sarah Chen'."
    },
    {
      "op": "update",
      "slug": "existing-slug",
      "summary": "Updated summary (only include if changing)",
      "patch": "FULL new markdown content of the page after your edits. Mostly the same as the previous content with additive changes. Not a diff — the whole page.",
      "change_summary": "Short past-tense description: e.g. 'Added contradiction note about Sarah's role'."
    }
  ],
  "source_links": [
    { "note_id": "uuid-of-the-note", "page_slugs": ["slug-supported-by-note"] }
  ],
  "log_summary": "One-line description of what happened."
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

function extractWikilinks(markdown: string): string[] {
  const matches = markdown.matchAll(/\[\[([a-z0-9-]+)\]\]/g);
  return [...new Set([...matches].map((m) => m[1]))];
}

function slugToWords(slug: string): string {
  return slug.replace(/-/g, " ").trim();
}

function normalizeForMatch(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Validate one synthesis action against the note text and existing page state.
 * Returns either an accepted action (possibly with stripped ungrounded links) or a rejection reason.
 */
function validateAction(
  action: WikiAction,
  noteText: string,
  existingContent: string | null,
): { ok: true; action: WikiAction } | { ok: false; reason: string } {
  const normalizedNote = normalizeForMatch(noteText + " " + (action.title || ""));
  const normalizedExisting = normalizeForMatch(existingContent || "");
  const newContent = action.op === "update" ? (action.patch || action.content || "") : (action.content || "");

  if (!newContent.trim()) return { ok: false, reason: "empty_content" };

  // Drift / overwrite protection on updates.
  if (action.op === "update" && existingContent && existingContent.length > 200) {
    const lengthRatio = newContent.length / existingContent.length;
    if (lengthRatio < (1 - MAX_DELETION_RATIO)) {
      return { ok: false, reason: "deletes_too_much_content" };
    }
  }

  // For create: the page subject (title or slug words) must appear in the note.
  if (action.op === "create") {
    const subject = normalizeForMatch(action.title || slugToWords(action.slug));
    if (subject && !normalizedNote.includes(subject)) {
      return { ok: false, reason: "subject_not_in_note" };
    }
  }

  // Strip wikilinks that aren't grounded in the note OR in the previous page content.
  const links = extractWikilinks(newContent);
  let strippedCount = 0;
  let cleaned = newContent;
  for (const slug of links) {
    if (slug === action.slug) continue; // self-link is fine
    const slugWords = normalizeForMatch(slugToWords(slug));
    const grounded =
      normalizedNote.includes(slugWords) ||
      normalizedExisting.includes(`[[${slug}]]`) ||
      normalizedExisting.includes(slugWords);
    if (!grounded) {
      // Replace the wikilink with plain bracketed text so we don't wreck readability,
      // but kill the link so we stop creating phantom relationships.
      const pattern = new RegExp(`\\[\\[${slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\]\\]`, "g");
      cleaned = cleaned.replace(pattern, slugToWords(slug));
      strippedCount += 1;
    }
  }

  if (strippedCount > MAX_UNGROUNDED_NEW_LINKS) {
    // Keep the cleaned content (links stripped) instead of rejecting outright.
    if (action.op === "update") {
      return { ok: true, action: { ...action, patch: cleaned } };
    }
    return { ok: true, action: { ...action, content: cleaned } };
  }

  return { ok: true, action };
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
      temperature: 0.1,
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
    .select("group_id, contact_id, contact_groups:group_id(id, slug, name)")
    .in("contact_id", personIds)
    .is("archived_at", null);
  if (membershipsError) throw membershipsError;

  const groups = new Map<string, { id: string; slug: string; name: string; personIds: Set<string> }>();
  for (const membership of memberships || []) {
    const group = membership.contact_groups;
    if (!group?.id || !group?.slug) continue;
    const current = groups.get(group.id) || { id: group.id, slug: group.slug, name: group.name || group.slug, personIds: new Set<string>() };
    current.personIds.add(membership.contact_id);
    groups.set(group.id, current);
  }
  if (groups.size === 0) return { updated: 0, skipped: "no_groups" };

  let updated = 0;
  const cutoff = Date.now() - 5 * 60 * 1000;
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  for (const group of groups.values()) {
    const { data: page, error: pageError } = await db
      .from("wiki_pages")
      .select("id, slug, title, content, last_synthesized_at, protected_sections")
      .eq("slug", `group-${group.slug}`)
      .eq("page_type", "group")
      .maybeSingle();
    if (pageError) throw pageError;
    if (!page) continue;
    if (page.last_synthesized_at && new Date(page.last_synthesized_at).getTime() > cutoff) continue;
    if (Array.isArray(page.protected_sections) && page.protected_sections.includes("insights")) continue;

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
      "You rewrite only the Insights section for a group Lexicon page. Return JSON only: {\"insights\": \"Markdown body for the Insights section, without the ## Insights heading\"}. Do not alter Purpose or Members. Do not invent facts. Only state things visibly supported by the supplied context.",
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

async function processIngest(
  db: any,
  userId: string,
  noteId: string,
  changeType: string,
  startedAt: number,
) {
  try {

    const { data: note, error: noteError } = await db
      .from("notes")
      .select("id, title, content, metadata")
      .eq("id", noteId)
      .maybeSingle();

    if (noteError) throw noteError;
    if (!note) {
      await logWiki(db, userId, "ingest_skipped", { reason: "note_not_found", note_id: noteId });
      return;
    }

    const contentText = noteContentToText(note.content);
    const meaningfulText = `${note.title || ""}\n${contentText}`.replace(/\s+/g, " ").trim();
    if (meaningfulText.length < 20) {
      await logWiki(db, userId, "ingest_skipped", { reason: "note_too_short", note_id: noteId });
      return;
    }

    const { data: existingPages, error: pagesError } = await db
      .from("wiki_pages")
      .select("id, slug, title, page_type, summary, content, protected_sections")
      .order("page_type", { ascending: true })
      .order("title", { ascending: true });
    if (pagesError) throw pagesError;

    const index = (existingPages || [])
      .map((page: any) => `${page.slug} | ${page.title} | ${page.page_type} | ${page.summary || ""}`)
      .join("\n") || "No existing pages yet.";

    const existingBySlug = new Map<string, { content: string; protected_sections: string[] }>();
    for (const page of existingPages || []) {
      existingBySlug.set(page.slug, {
        content: page.content || "",
        protected_sections: Array.isArray(page.protected_sections) ? page.protected_sections : [],
      });
    }

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
      return;
    }

    // Grounding validation pass.
    const validationLog: Array<{ slug: string; outcome: string; reason?: string }> = [];
    const acceptedActions: WikiAction[] = [];
    for (const action of parsed.actions) {
      const existing = existingBySlug.get(action.slug)?.content ?? null;
      const result = validateAction(action, contentText, existing);
      if (!result.ok) {
        validationLog.push({ slug: action.slug, outcome: "rejected", reason: result.reason });
        continue;
      }

      // Respect user-protected sections: never overwrite content the user has edited.
      const meta = existingBySlug.get(action.slug);
      if (meta && meta.protected_sections.length > 0) {
        const proposed = (result.action as any).content ?? (result.action as any).patch ?? "";
        const merged = mergeWithProtectedSections(meta.content, proposed, meta.protected_sections);
        if ((result.action as any).content !== undefined) (result.action as any).content = merged;
        if ((result.action as any).patch !== undefined) (result.action as any).patch = merged;
        validationLog.push({ slug: action.slug, outcome: "accepted_merged_protected" });
      } else {
        validationLog.push({ slug: action.slug, outcome: "accepted" });
      }
      acceptedActions.push(result.action);
    }
    parsed.actions = acceptedActions;
    // Also drop source_links pointing to rejected pages.
    const acceptedSlugs = new Set(acceptedActions.map((a) => a.slug));
    parsed.source_links = parsed.source_links
      .map((link) => ({ ...link, page_slugs: link.page_slugs.filter((slug) => acceptedSlugs.has(slug) || existingBySlug.has(slug)) }))
      .filter((link) => link.page_slugs.length > 0);

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
      validation: validationLog,
      log_summary: parsed.log_summary,
      duration_ms: durationMs,
      apply_result: applyResult,
      group_insights: groupInsightsResult,
    });

    return {
      ok: true,
      summary: parsed.log_summary,
      action_count: parsed.actions.length,
      validation: validationLog,
      group_insights: groupInsightsResult,
      duration_ms: durationMs,
    };
  } catch (error) {
    console.error("wiki-ingest background failed", error);
    if (db && userId) {
      await logWiki(db, userId, "ingest_failed", {
        note_id: noteId,
        error: error instanceof Error ? error.message : String(error),
        duration_ms: Date.now() - startedAt,
      }).catch((logError: unknown) => console.error("failed to log wiki ingest failure", logError));
    }
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const startedAt = Date.now();

  try {
    const token = extractBearer(req);
    if (!token) return jsonResponse({ error: "Unauthenticated" }, 401);

    const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { data: userData, error: userError } = await authClient.auth.getUser(token);
    if (userError || !userData.user) return jsonResponse({ error: "Unauthenticated" }, 401);
    const userId = userData.user.id;

    const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const body = await req.json().catch(() => ({}));
    const noteId = body.note_id;
    const changeType = body.change_type;
    if (!isUuid(noteId) || !["INSERT", "UPDATE"].includes(changeType)) {
      return jsonResponse({ error: "Invalid request body" }, 400);
    }

    // Run heavy AI synthesis in the background so we don't hit the 150s edge timeout.
    // @ts-expect-error — EdgeRuntime is provided by Supabase Edge Runtime.
    EdgeRuntime.waitUntil(processIngest(db, userId, noteId, changeType, startedAt));

    return jsonResponse({ accepted: true, note_id: noteId }, 202);
  } catch (error) {
    console.error("wiki-ingest dispatch failed", error);
    return jsonResponse({ error: "Lexicon ingest failed" }, 500);
  }
});

// TODO: Add a wiki_ingest_jobs queue table later if duplicate work becomes a problem.
