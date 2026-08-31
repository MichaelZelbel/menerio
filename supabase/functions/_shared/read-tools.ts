/**
 * Shared read-only tools for the chat agents (note-chat, conversation-chat,
 * collection-chat).
 *
 * These tools let an agent look things up across the user's brain without
 * mutating anything: dated facts, semantic note search, text note search,
 * media/OCR search, and structured person-profile lookup. Ported out of
 * note-chat so Mira (conversation-chat) can use the exact same
 * implementations.
 *
 * Read-only by design — the note-mutating tools (append/update/wikilink) stay
 * local to note-chat, which is the only agent with a "current note".
 *
 * `search_claims` is first in the list on purpose. The assistant used to see
 * notes and media and nothing else, so it answered "I don't have your street
 * address on file" while the address sat in the claims table, dated, quoted
 * and embedded. A fact store the app cannot read is a fact store the app does
 * not have.
 */
import { openRouterWithCredits } from "./llm-credits.ts";
import { ilikeAnyColumn } from "./postgrest-filters.ts";
import {
  flagConflicts,
  flagStale,
  judgeDayFor,
  renderClaimHit,
  toClaimHits,
  type ClaimHit,
} from "./claim-search.ts";
import { todayISO } from "./claims.ts";

const SEMANTIC_EMBED_MODEL = "openai/text-embedding-3-small";

/**
 * The B arm of the doubt-date measurement (Plan 4 Task 4).
 *
 * Set the function secret CLAIMS_STALE_LABELS=off and the assistant still sees
 * every claim, with the same dates in the same data, and is simply not told
 * which ones are past their re-check date. That is the ONE variable the
 * measurement moves, and moving it in the deployed function is what keeps the
 * measurement honest: both arms are the real in-app assistant, not a harness
 * that resembles it.
 *
 * Deliberately an environment secret rather than a request field. A request
 * field is product surface that has to be authorised, documented and defended
 * for ever, for the sake of one experiment; a secret is flipped for the length
 * of a run and unset afterwards, and no caller can reach it.
 *
 * Absent means ON, so an unconfigured deployment always labels.
 */
const STALE_LABELS_ON =
  (typeof Deno !== "undefined" ? Deno.env.get("CLAIMS_STALE_LABELS") : undefined) !== "off";

/** Rule 2. Lifted out so the B arm of the measurement can drop exactly it. */
const CLAIMS_CONTRACT_STALE_RULE = `2. A stale fact is still usable, and you must report its date. When a claim
   comes back marked NOT CONFIRMED SINCE, give the value AND say when it was
   last confirmed. Do not refuse it, and do not present it as current.`;

/** What rule 2 becomes when labels are off: nothing, not a mention of absence. */
const CLAIMS_CONTRACT_NO_STALE_RULE =
  `2. Every fact you are shown is the value currently on file. Answer from it.`;

/**
 * The three rules a caller must follow once it can see dated facts.
 *
 * Appended to every chat agent's system prompt in code rather than only in the
 * default prompt text, so an admin overriding a prompt in `llm_call_configs`
 * cannot silently remove them. The MCP tool description already carries the
 * same three; this is the in-app half of the same contract.
 */
export const CLAIMS_CONTRACT = `

--- DATED FACTS ---
The user's facts live in two places, and they are not equal. A CLAIM is a
structured fact with a date, a confidence and the sentence it came from. A note
is prose that may contain a fact somewhere in it.

1. Prefer a dated claim over a sentence in a note, and say which one you used.
   Call \`search_claims\` before answering any question about a fact of the
   user's life — an address, a phone number, a job, a count, a preference, who
   someone is to them. If a claim answers it, answer from the claim and name it
   as a dated fact. Do not say you have nothing on file before you have called
   that tool.
${STALE_LABELS_ON ? CLAIMS_CONTRACT_STALE_RULE : CLAIMS_CONTRACT_NO_STALE_RULE}
3. Two live answers are both reported, never silently resolved. When a claim
   comes back marked DISAGREES WITH, give every value and say they disagree.
   Two live answers usually mean one name covers two different facts, not that
   one of them is wrong. Picking a winner is how a real fact disappears.
--- END DATED FACTS ---`;

/** OpenAI-style tool schemas for the read tools. */
export const READ_TOOL_SCHEMAS = [
  {
    type: "function",
    function: {
      name: "search_claims",
      description:
        "Search the user's DATED FACTS by meaning. This is the structured fact store: each hit carries a value, the dates it is believed between, a confidence, and the sentence it came from. " +
        "CALL THIS FIRST for any question about a fact of the user's own life — their address, phone number, email, employer, job, where they live, a count or streak, a preference, a possession, who someone is to them. " +
        "These facts are NOT in the notes index and note search cannot see them, so answering 'I don't have that on file' without calling this tool is wrong. " +
        "Superseded facts are filtered out in the database, so anything returned is believed true today. " +
        (STALE_LABELS_ON
          ? "A hit marked NOT CONFIRMED SINCE is still usable — give the value and say when it was last confirmed. "
          : "") +
        "A hit marked DISAGREES WITH has more than one live answer — report every value, never pick one.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "What you want to know, in the user's own words (e.g. 'street address', 'duolingo streak', 'who is my manager')",
          },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_notes_semantic",
      description:
        "Search the user's notes by meaning using vector similarity. Best for conceptual or fuzzy queries. " +
        "For a plain fact about the user's life, prefer `search_claims` — a dated fact beats a sentence in a note. " +
        "This tool returns any matching dated facts above the notes for that reason.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "The search query to find semantically similar notes" },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_notes_text",
      description:
        "Search the user's notes by exact text match (ILIKE). Best for finding specific words, names, or phrases.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "The text to search for in note titles and content" },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_media_text",
      description:
        "Search across OCR-extracted text and descriptions from images and PDFs in ALL of the user's notes. Use this when looking for text that might appear in scanned documents, photos, or PDF attachments.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "The text to search for in media extracted text and descriptions" },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_person_profile",
      description:
        "Look up a person from the user's People list by name and return their full profile: attribute entries (label/value by category), relationships, and aliases. Use this FIRST for any question about a specific person or their profile data — profiles are structured data that note search cannot see.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "The person's name (or nickname/alias) to look up" },
        },
        required: ["name"],
        additionalProperties: false,
      },
    },
  },
];

export const READ_TOOL_NAMES = READ_TOOL_SCHEMAS.map((t) => t.function.name);

/**
 * Load a contact's structured profile (entries + relationships) for the
 * get_person_profile tool and for person-page context injection.
 */
export async function loadPersonProfile(db: any, userId: string, contactId: string) {
  const { data: contact } = await db
    .from("contacts")
    .select("id, name, aliases")
    .eq("id", contactId)
    .eq("user_id", userId)
    .is("merged_into", null)
    .maybeSingle();
  if (!contact) return null;

  const { data: entries } = await db
    .from("profile_entries")
    .select("label, value, profile_categories(name, slug)")
    .eq("user_id", userId)
    .eq("contact_id", contactId)
    .limit(100);

  const { data: rels } = await db
    .from("contact_relationships")
    .select("source_type, source_id, target_type, target_id, label")
    .eq("user_id", userId)
    .or(`source_id.eq.${contactId},target_id.eq.${contactId}`);

  const otherIds = new Set<string>();
  for (const r of (rels || []) as any[]) {
    if (r.source_type === "contact" && r.source_id && r.source_id !== contactId) otherIds.add(r.source_id);
    if (r.target_type === "contact" && r.target_id && r.target_id !== contactId) otherIds.add(r.target_id);
  }
  let names: Record<string, string> = {};
  if (otherIds.size > 0) {
    const { data: others } = await db.from("contacts").select("id, name").in("id", [...otherIds]);
    names = Object.fromEntries((others || []).map((c: any) => [c.id, c.name]));
  }
  const describe = (type: string, id: string | null) =>
    type === "self" ? "the user" : id === contactId ? contact.name : names[id || ""] || "unknown";

  return {
    person: { id: contact.id, name: contact.name, aliases: (contact.aliases || []) as string[] },
    profile_entries: ((entries || []) as any[]).map((e: any) => ({
      category: e.profile_categories?.name || e.profile_categories?.slug || "other",
      label: e.label,
      value: e.value,
    })),
    relationships: ((rels || []) as any[]).map((r: any) => ({
      from: describe(r.source_type, r.source_id),
      label: r.label,
      to: describe(r.target_type, r.target_id),
    })),
  };
}

/**
 * Embed a query with the model claims and note chunks BOTH use.
 *
 * One model, one dimension, so a single vector can be pushed at
 * `match_note_chunks` and `match_claims` in the same turn. That is why
 * `search_notes_semantic` can return claims without paying for a second
 * embedding.
 */
async function embedQuery(db: any, apiKey: string, userId: string, query: string): Promise<string> {
  const embResult = await openRouterWithCredits(
    db,
    apiKey,
    userId,
    "chat:tool:semantic-search",
    "embeddings",
    { model: SEMANTIC_EMBED_MODEL, input: query }
  );
  return `[${embResult.result.data[0].embedding.join(",")}]`;
}

/**
 * The claim arm, shared by the `search_claims` tool and by
 * `search_notes_semantic`.
 *
 * `p_as_of` is null on purpose: that makes the RPC resolve the user's OWN day
 * from their timezone. Passing a UTC date here is the bug that made two
 * freshly written facts invisible — at 23:28 UTC the server's day was still
 * yesterday while the user's was already today, and for a user at UTC+2 every
 * fact recorded after 22:00 local vanished for two hours with no error
 * anywhere.
 *
 * Returns [] on any failure. A claim search that throws must not take the note
 * search down with it.
 */
export async function searchClaims(
  db: any,
  userId: string,
  embedding: string,
  limit = 12
): Promise<ClaimHit[]> {
  try {
    const { data, error } = await db.rpc("match_claims", {
      query_embedding: embedding,
      match_threshold: 0.2,
      match_count: Math.max(limit, 20),
      p_user_id: userId,
      p_as_of: null,
    });
    if (error || !data) return [];

    // Resolve every subject's display name in at most two extra queries, not
    // one per row.
    const rows = data as any[];
    const contactIds = [...new Set(rows.filter((r) => r.subject_type === "contact" && r.subject_id).map((r) => r.subject_id))];
    const entityIds = [...new Set(rows.filter((r) => r.subject_type === "entity" && r.subject_id).map((r) => r.subject_id))];
    const names = new Map<string, string>();
    if (contactIds.length) {
      const { data: cs } = await db.from("contacts").select("id, name").in("id", contactIds);
      for (const c of cs || []) names.set(c.id, c.name);
    }
    if (entityIds.length) {
      const { data: es } = await db.from("entities").select("id, name").in("id", entityIds);
      for (const e of es || []) names.set(e.id, e.name);
    }

    const hits = toClaimHits(rows, (kind, id) =>
      kind === "self" ? "you" : (id && names.get(id)) || "someone");
    const flagged = flagStale(flagConflicts(hits), judgeDayFor(null, hits, todayISO()));
    // The B arm keeps every fact and every date. Only the "this is old" signal
    // is withheld, which is the single variable the measurement moves.
    if (!STALE_LABELS_ON) for (const h of flagged) h.stale_since = null;
    return flagged.slice(0, limit);
  } catch {
    return [];
  }
}

/**
 * Execute one of the read tools. Returns a JSON string for the agent loop.
 * `apiKey` is the OpenRouter key (for the semantic-search embedding).
 */
export async function executeReadTool(
  db: any,
  apiKey: string,
  userId: string,
  name: string,
  args: Record<string, unknown>
): Promise<string> {
  switch (name) {
    case "search_claims": {
      const query = String(args.query || "").trim();
      if (!query) return JSON.stringify({ error: "query required" });
      let embeddingStr: string;
      try {
        embeddingStr = await embedQuery(db, apiKey, userId, query);
      } catch (e) {
        return JSON.stringify({ error: `Could not embed the query: ${(e as Error)?.message}` });
      }
      const claims = await searchClaims(db, userId, embeddingStr);
      if (claims.length === 0) {
        return JSON.stringify({
          found: false,
          count: 0,
          message:
            `No dated fact matches "${query}". The fact may still be in a note — try search_notes_semantic before telling the user you have nothing.`,
        });
      }
      // Rendered as text, not as raw rows: the dates, the NOT CONFIRMED SINCE
      // line and the DISAGREES WITH line are the entire advantage a claim has
      // over a sentence in a note, and a model reads them far more reliably
      // as prose than as JSON fields it has to remember to look at.
      return JSON.stringify({
        found: true,
        count: claims.length,
        facts: claims.map(renderClaimHit).join("\n"),
      });
    }

    case "search_notes_semantic": {
      const query = args.query as string;
      try {
        const embeddingStr = await embedQuery(db, apiKey, userId, query);
        // The same vector answers both stores, so the dated facts cost no
        // extra embedding call. They are returned ABOVE the notes because a
        // dated fact beats a sentence in a note, and because an agent that
        // only ever reaches for note search must still see them.
        const claims = await searchClaims(db, userId, embeddingStr, 8);
        const { data, error } = await db.rpc("match_note_chunks", {
          query_embedding: embeddingStr,
          match_threshold: 0.5,
          match_count: 30,
          p_user_id: userId,
        });
        if (error) throw error;
        const byNote = new Map<string, any>();
        for (const c of (data || []) as any[]) {
          const ex = byNote.get(c.note_id);
          if (!ex || c.similarity > ex.similarity) {
            byNote.set(c.note_id, {
              id: c.note_id,
              title: c.note_title,
              content: String(c.content || "").slice(0, 500),
              similarity: c.similarity,
              chunk_heading_path: c.heading_path,
            });
          }
        }
        const candidateIds = Array.from(byNote.keys());
        if (candidateIds.length > 0) {
          const { data: visible } = await db
            .from("notes")
            .select("id")
            .in("id", candidateIds)
            .eq("ai_visibility", "visible");
          const visibleSet = new Set((visible || []).map((n: any) => n.id));
          for (const id of candidateIds) {
            if (!visibleSet.has(id)) byNote.delete(id);
          }
        }
        const results = Array.from(byNote.values()).slice(0, 10);
        return JSON.stringify({
          ...(claims.length
            ? {
                dated_facts: claims.map(renderClaimHit).join("\n"),
                dated_facts_note:
                  "These are dated facts from the structured store. Prefer them over the note snippets below, and say the answer came from a dated fact.",
              }
            : {}),
          results,
          count: results.length,
        });
      } catch {
        return executeReadTool(db, apiKey, userId, "search_notes_text", args);
      }
    }

    case "search_notes_text": {
      const q = (args.query as string).toLowerCase();
      const { data, error } = await db
        .from("notes")
        .select("id, title, content, tags, metadata")
        .eq("user_id", userId)
        .eq("is_trashed", false)
        .eq("ai_visibility", "visible")
        .or(ilikeAnyColumn(["title", "content"], q))
        .order("updated_at", { ascending: false })
        .limit(10);
      if (error) return JSON.stringify({ error: error.message });
      const results = (data || []).map((n: any) => ({
        id: n.id,
        title: n.title,
        content: n.content?.substring(0, 500),
        tags: n.tags,
      }));
      return JSON.stringify({ results, count: results.length });
    }

    case "search_media_text": {
      const q = (args.query as string).toLowerCase();
      const { data, error } = await db
        .from("media_analysis")
        .select("id, note_id, storage_path, media_type, page_number, original_filename, extracted_text, description, topics")
        .eq("user_id", userId)
        .eq("analysis_status", "complete")
        .or(ilikeAnyColumn(["extracted_text", "description"], q))
        .order("created_at", { ascending: false })
        .limit(10);
      if (error) return JSON.stringify({ error: error.message });
      const noteIds = [...new Set((data || []).map((m: any) => m.note_id))];
      let noteTitles: Record<string, string> = {};
      if (noteIds.length > 0) {
        const { data: notes } = await db.from("notes").select("id, title").in("id", noteIds);
        noteTitles = Object.fromEntries((notes || []).map((n: any) => [n.id, n.title]));
      }
      const results = (data || []).map((m: any) => ({
        id: m.id,
        note_id: m.note_id,
        note_title: noteTitles[m.note_id] || "Unknown",
        filename: m.original_filename,
        media_type: m.media_type,
        page_number: m.page_number,
        description: m.description?.substring(0, 300),
        extracted_text: m.extracted_text?.substring(0, 500),
        topics: m.topics,
      }));
      return JSON.stringify({ results, count: results.length });
    }

    case "get_person_profile": {
      const rawName = String(args.name || "").trim();
      if (!rawName) return JSON.stringify({ error: "name required" });
      const q = rawName.toLowerCase();
      let matches: any[] = [];
      const { data: byName } = await db
        .from("contacts")
        .select("id, name, aliases")
        .eq("user_id", userId)
        .is("merged_into", null)
        .ilike("name", `%${q}%`)
        .limit(5);
      matches = byName || [];
      if (matches.length === 0) {
        const { data: all } = await db
          .from("contacts")
          .select("id, name, aliases")
          .eq("user_id", userId)
          .is("merged_into", null)
          .limit(500);
        matches = ((all || []) as any[])
          .filter((c) => (c.aliases || []).some((a: string) => String(a).toLowerCase().includes(q)))
          .slice(0, 5);
      }
      if (matches.length === 0) {
        return JSON.stringify({ found: false, message: `No person named "${rawName}" in the user's People list.` });
      }
      if (matches.length > 1) {
        return JSON.stringify({
          ambiguous: true,
          candidates: matches.map((m) => ({ id: m.id, name: m.name })),
          hint: "Multiple people matched — call again with a more specific name.",
        });
      }
      const profile = await loadPersonProfile(db, userId, matches[0].id);
      if (!profile) return JSON.stringify({ found: false, message: "Person not found." });
      return JSON.stringify({ found: true, ...profile });
    }

    default:
      return JSON.stringify({ error: `Unknown read tool: ${name}` });
  }
}
