import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  checkBalance,
  getEmbeddingWithCredits,
  chatWithCredits,
  insufficientCreditsResponse,
} from "../_shared/llm-credits.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

/** Strip HTML tags and decode common entities to produce plain text.
 *  Also handles markdown content (passes through mostly as-is). */
function stripHtmlIfNeeded(content: string): string {
  // If content doesn't look like HTML, it's already markdown — return as-is
  if (!/<(?:p|h[1-6]|ul|ol|li|blockquote|pre|img|table)\b/i.test(content)) {
    return content;
  }
  // Legacy HTML content — strip tags
  return content
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/* ── Levenshtein distance (lightweight, no deps) ── */
function levenshtein(a: string, b: string): number {
  const la = a.length, lb = b.length;
  if (la === 0) return lb;
  if (lb === 0) return la;
  const dp: number[] = Array.from({ length: lb + 1 }, (_, i) => i);
  for (let i = 1; i <= la; i++) {
    let prev = i - 1;
    dp[0] = i;
    for (let j = 1; j <= lb; j++) {
      const tmp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  return dp[lb];
}

/** Returns true if two names are "close enough" to be the same person */
function isFuzzyMatch(a: string, b: string): boolean {
  const la = a.toLowerCase(), lb = b.toLowerCase();
  if (la === lb) return true;
  const dist = levenshtein(la, lb);
  const maxLen = Math.max(la.length, lb.length);
  // For short names (≤5 chars) allow distance 1; otherwise allow 2 or normalized < 0.3
  if (maxLen <= 5) return dist <= 1;
  return dist <= 2 || dist / maxLen < 0.3;
}

/** Check if a name appears (approximately) in the source text */
function nameAppearsInText(name: string, text: string): boolean {
  const lower = text.toLowerCase();
  const nameLower = name.toLowerCase();
  // Direct substring check
  if (lower.includes(nameLower)) return true;
  // Check individual words of the name against text words
  const nameWords = nameLower.split(/\s+/);
  return nameWords.some((w) => w.length >= 3 && lower.includes(w));
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const METADATA_SYSTEM_PROMPT = `Extract metadata from the user's note. Return JSON with:
- "title": If the first line of the note is 10 words or fewer and reads like a natural title or heading, use it verbatim. Otherwise, generate a concise title (max 8 words) that captures the essence of the note.
- "people": array of people mentioned (empty if none)

- "dates_mentioned": array of dates in YYYY-MM-DD format (empty if none)
- "topics": array of 1-5 short topic tags (always generate at least one)
- "type": one of "observation", "task", "idea", "reference", "person_note", "meeting_note", "decision", "project"
- "sentiment": one of "positive", "negative", "neutral"
- "summary": one-sentence summary of the note
Only extract what's explicitly there. Don't invent details.`;

const PROFILE_CATEGORY_SLUGS = [
  "identity", "location", "professional", "education", "relationships",
  "communication", "personality", "principles", "health", "hobbies",
  "food", "entertainment", "travel", "digital", "financial", "goals", "preferences",
];

const PROFILE_EXTRACTION_PROMPT = `You are analyzing a note that mentions specific people. For each person listed, extract any profile-worthy facts from the note content.

Return a JSON object with two keys:
1. "facts": an array of profile fact objects, each with:
   - "contact_name": the person's name exactly as provided
   - "category_slug": one of: ${PROFILE_CATEGORY_SLUGS.join(", ")}
   - "label": a short label for the fact (e.g. "Favorite cuisine", "Current city", "Job title")
   - "value": the actual value (e.g. "Japanese", "Berlin", "Software Engineer")

2. "relationships": an array of relationship objects, each with:
   - "person_a": name of the first person
   - "person_b": name of the second person (can be "me" or "myself" if referring to the note author)
   - "label_a_to_b": what person_a is to person_b (e.g. "employee", "brother", "friend", "mentor")
   - "label_b_to_a": what person_b is to person_a (e.g. "employer", "brother", "friend", "mentee")

Rules:
- Only extract facts/relationships clearly stated or strongly implied in the note
- Do NOT invent or assume
- Skip vague or uncertain information
- Return empty arrays if nothing found
- Keep labels concise
- For relationships, use standard labels when possible: employee, employer, friend, brother, sister, mother, father, son, daughter, partner, spouse, mentor, mentee, manager, report, co-worker, neighbor, roommate, client, provider, teacher, student`;

/* ── Review Queue suggestion generator ── */
async function generateReviewItems(
  userId: string,
  noteId: string,
  noteTitle: string,
  noteContent: string,
  metadata: Record<string, unknown>,
) {
  try {
    const people = Array.isArray(metadata.people) ? (metadata.people as string[]) : [];
    const dates = Array.isArray(metadata.dates_mentioned) ? (metadata.dates_mentioned as string[]) : [];
    const noteType = metadata.type as string | undefined;
    const summary = (metadata.summary as string) || noteTitle;

    const suggestions: Array<{
      user_id: string;
      source_note_id: string;
      suggestion_type: string;
      title: string;
      description: string;
      payload: Record<string, unknown>;
      status: string;
    }> = [];

    // Check which apps are connected
    const { data: connectedApps } = await supabase
      .from("connected_apps")
      .select("app_name")
      .eq("user_id", userId)
      .eq("connection_status", "active")
      .eq("is_active", true);

    const activeApps = new Set((connectedApps || []).map((a: any) => a.app_name));

    // Event detection: dates + people → suggest Temerio / Cherishly
    if (dates.length > 0 && (people.length > 0 || noteType === "meeting_note")) {
      const headline = noteTitle || summary;
      const happened_at = dates[0] + "T12:00";

      if (activeApps.has("temerio")) {
        suggestions.push({
          user_id: userId,
          source_note_id: noteId,
          suggestion_type: "add_event_temerio",
          title: `Add "${headline}" as a Temerio event`,
          description: `Detected date ${dates[0]} and people: ${people.join(", ") || "—"}. This looks like an event worth tracking.`,
          payload: {
            headline,
            description: summary,
            happened_at,
            people_names: people,
            emotion_valence: 0.7,
            category: "life",
          },
          status: "pending",
        });
      }

      if (activeApps.has("cherishly")) {
        suggestions.push({
          user_id: userId,
          source_note_id: noteId,
          suggestion_type: "add_event_cherishly",
          title: `Add "${headline}" to Cherishly`,
          description: `A moment with ${people.join(", ") || "someone special"} on ${dates[0]}. Save it as a cherished memory?`,
          payload: {
            headline,
            description: summary,
            happened_at,
            people_names: people,
            emotion_valence: 0.8,
            category: "life",
          },
          status: "pending",
        });
      }
    }

    // Person detection: check if mentioned people exist as contacts (alias-aware)
    if (people.length > 0) {
      const { data: existingContacts } = await supabase
        .from("contacts")
        .select("id, name, aliases")
        .eq("user_id", userId)
        .is("merged_into", null);

      const nameToContact = new Map<string, { id: string; name: string }>();
      for (const c of (existingContacts || []) as any[]) {
        nameToContact.set(c.name.toLowerCase(), { id: c.id, name: c.name });
        if (Array.isArray(c.aliases)) {
          for (const alias of c.aliases) {
            if (alias) nameToContact.set(alias.toLowerCase(), { id: c.id, name: c.name });
          }
        }
      }

      const fullText = `${noteTitle}\n${noteContent}`;
      for (const person of people) {
        // 1. Exact match
        if (nameToContact.has(person.toLowerCase())) continue;

        // 2. Fuzzy match — find close match among all contact names/aliases
        let fuzzyMatch: { id: string; name: string } | null = null;
        for (const [key, contact] of nameToContact) {
          if (isFuzzyMatch(person, key)) {
            fuzzyMatch = contact;
            break;
          }
        }

        if (fuzzyMatch) {
          // Suggest adding as alias instead of new contact
          suggestions.push({
            user_id: userId,
            source_note_id: noteId,
            suggestion_type: "add_alias",
            title: `Add "${person}" as alias for ${fuzzyMatch.name}`,
            description: `"${person}" in "${noteTitle}" looks like ${fuzzyMatch.name}. Add as alternate spelling?`,
            payload: { contact_id: fuzzyMatch.id, contact_name: fuzzyMatch.name, alias: person },
            status: "pending",
          });
          continue;
        }

        // 3. No match — validate name appears in source text before suggesting
        if (!nameAppearsInText(person, fullText)) {
          console.log(`Skipping hallucinated name "${person}" — not found in note text`);
          continue;
        }

        suggestions.push({
          user_id: userId,
          source_note_id: noteId,
          suggestion_type: "add_contact",
          title: `Add "${person}" to your People`,
          description: `${person} was mentioned in "${noteTitle}" but isn't in your contacts yet.`,
          payload: { name: person },
          status: "pending",
        });
      }
    }

    // Deduplicate against existing pending/accepted/dismissed suggestions
    if (suggestions.length > 0) {
      const { data: existing } = await supabase
        .from("review_queue")
        .select("id, suggestion_type, source_note_id, title, status")
        .eq("user_id", userId)
        .in("status", ["pending", "accepted", "dismissed", "skipped"]);

      const existingSet = new Set(
        (existing || [])
          .filter((e: any) => e.status !== "skipped")
          .map((e: any) => `${e.suggestion_type}|${e.title}`),
      );

      // Re-pending: reset skipped items that match new suggestions back to pending
      const skippedItems = (existing || []).filter((e: any) => e.status === "skipped");
      for (const suggestion of suggestions) {
        const key = `${suggestion.suggestion_type}|${suggestion.title}`;
        const skippedMatch = skippedItems.find(
          (e: any) => `${e.suggestion_type}|${e.title}` === key,
        );
        if (skippedMatch) {
          await supabase
            .from("review_queue")
            .update({ status: "pending", reviewed_at: null })
            .eq("id", skippedMatch.id);
          console.log(`Re-pending skipped suggestion: ${skippedMatch.title}`);
        }
      }

      const newSuggestions = suggestions.filter(
        (s) => {
          const key = `${s.suggestion_type}|${s.title}`;
          const alreadyExists = existingSet.has(key);
          const wasSkipped = skippedItems.some(
            (e: any) => `${e.suggestion_type}|${e.title}` === key,
          );
          return !alreadyExists && !wasSkipped;
        },
      );

      if (newSuggestions.length > 0) {
        const { error } = await supabase.from("review_queue").insert(newSuggestions);
        if (error) console.error("review_queue insert error:", error);
        else console.log(`Created ${newSuggestions.length} review suggestions for note ${noteId} (${suggestions.length - newSuggestions.length} duplicates skipped)`);
      } else {
        console.log(`All ${suggestions.length} suggestions already exist for note ${noteId}, skipping`);
      }
    }
  } catch (err) {
    console.error("generateReviewItems error:", err);
  }
}

/* ── Profile fact extraction for matched people ── */
async function generateProfileSuggestions(
  userId: string,
  noteId: string,
  noteTitle: string,
  noteContent: string,
  matchedPeople: Array<{ name: string; contact_id: string; canonical_name: string }>,
) {
  if (matchedPeople.length === 0) return;

  try {
    // Check balance before making another LLM call
    const balance = await checkBalance(supabase, userId);
    if (!balance.allowed) {
      console.log(`Skipping profile extraction for note ${noteId}: insufficient credits`);
      return;
    }

    const peopleList = matchedPeople.map((p) => p.canonical_name).join(", ");
    const cleanContent = stripHtmlIfNeeded(noteContent);
    const userPrompt = `People mentioned: ${peopleList}\n\nNote title: ${noteTitle}\nNote content:\n${cleanContent}`;

    let extractedFacts: Array<{
      contact_name: string;
      category_slug: string;
      label: string;
      value: string;
    }> = [];
    let extractedRelationships: Array<{
      person_a: string;
      person_b: string;
      label_a_to_b: string;
      label_b_to_a: string;
    }> = [];

    try {
      const result = await chatWithCredits(
        supabase, OPENROUTER_API_KEY, userId, "process-note-profile",
        [
          { role: "system", content: PROFILE_EXTRACTION_PROMPT },
          { role: "user", content: userPrompt },
        ],
        { response_format: { type: "json_object" } },
      );

      const rawContent = result.result.choices[0].message.content;
      console.log(`[profile-extract] Raw LLM response for note ${noteId}:`, rawContent);
      const parsed = JSON.parse(rawContent);

      // Normalize response shapes for facts
      let parseShape: string;
      if (Array.isArray(parsed)) {
        extractedFacts = parsed;
        parseShape = "array";
      } else if (typeof parsed === "object" && parsed !== null) {
        // New expected shape: { facts: [...], relationships: [...] }
        if (Array.isArray(parsed.facts)) {
          extractedFacts = parsed.facts;
          parseShape = "structured";
        } else {
          const arrayVal = Object.values(parsed).find((v) => Array.isArray(v)) as any[] | undefined;
          if (arrayVal) {
            extractedFacts = arrayVal;
            parseShape = "wrapped-array";
          } else if (parsed.contact_name && parsed.value) {
            extractedFacts = [parsed];
            parseShape = "single-object";
          } else {
            extractedFacts = [];
            parseShape = "invalid-object";
          }
        }

        // Extract relationships
        if (Array.isArray(parsed.relationships)) {
          extractedRelationships = parsed.relationships.filter(
            (r: any) => r.person_a && r.person_b && r.label_a_to_b
          ).map((r: any) => ({
            person_a: (r.person_a || "").trim(),
            person_b: (r.person_b || "").trim(),
            label_a_to_b: (r.label_a_to_b || "").trim().toLowerCase(),
            label_b_to_a: (r.label_b_to_a || r.label_a_to_b || "").trim().toLowerCase(),
          }));
        }
      } else {
        extractedFacts = [];
        parseShape = "invalid";
      }

      // Normalize string fields
      extractedFacts = extractedFacts.map((f: any) => ({
        contact_name: (f.contact_name || "").trim(),
        category_slug: (f.category_slug || "").trim().toLowerCase(),
        label: (f.label || "").trim(),
        value: (f.value || "").trim(),
      }));

      console.log(`[profile-extract] parseShape=${parseShape}, factsCount=${extractedFacts.length}, relationshipsCount=${extractedRelationships.length} for note ${noteId}`);
    } catch (err: any) {
      if (err.message === "INSUFFICIENT_CREDITS") {
        console.log(`Credit limit reached during profile extraction for note ${noteId}`);
        return;
      }
      console.error("Profile extraction LLM error:", err);
      return;
    }

    if (extractedFacts.length === 0) {
      console.log(`No profile facts extracted from note ${noteId} (0 after parsing)`);
      return;
    }

    // Filter to valid category slugs and match to contacts
    const nameToContact = new Map(
      matchedPeople.map((p) => [p.canonical_name.toLowerCase(), p]),
    );
    // Also map by original extracted name
    for (const p of matchedPeople) {
      nameToContact.set(p.name.toLowerCase(), p);
    }

    const validFacts = extractedFacts.filter((f) => {
      if (!f.contact_name || !f.category_slug || !f.label || !f.value) return false;
      if (!PROFILE_CATEGORY_SLUGS.includes(f.category_slug)) {
        console.log(`[profile-extract] Dropping fact: invalid category_slug="${f.category_slug}"`);
        return false;
      }
      // Fuzzy match contact name against known contacts
      const exactMatch = nameToContact.has(f.contact_name.toLowerCase());
      if (exactMatch) return true;
      // Try fuzzy matching
      for (const [key, contact] of nameToContact) {
        if (isFuzzyMatch(f.contact_name, key)) {
          // Rewrite contact_name to canonical for downstream matching
          f.contact_name = contact.canonical_name;
          return true;
        }
      }
      console.log(`[profile-extract] Dropping fact: unmatched contact_name="${f.contact_name}"`);
      return false;
    });

    console.log(`[profile-extract] ${extractedFacts.length} parsed → ${validFacts.length} valid for note ${noteId}`);

    if (validFacts.length === 0) {
      return;
    }

    // Get existing profile entries for these contacts to avoid duplicates
    const contactIds = [...new Set(validFacts.map((f) => nameToContact.get(f.contact_name.toLowerCase())!.contact_id))];

    const { data: existingEntries } = await supabase
      .from("profile_entries")
      .select("contact_id, label, value, category_id")
      .eq("user_id", userId)
      .in("contact_id", contactIds);

    // Get existing categories for these contacts to map slugs to IDs
    const { data: existingCategories } = await supabase
      .from("profile_categories")
      .select("id, slug, contact_id")
      .eq("user_id", userId)
      .in("contact_id", contactIds);

    const entrySet = new Set(
      (existingEntries || []).map((e: any) => `${e.contact_id}|${e.label.toLowerCase()}|${e.value.toLowerCase()}`),
    );

    // Check existing review_queue for duplicate profile suggestions
    const { data: existingQueueItems } = await supabase
      .from("review_queue")
      .select("payload, status")
      .eq("user_id", userId)
      .eq("suggestion_type", "add_profile_entry")
      .in("status", ["pending", "accepted", "dismissed"]);

    const queueSet = new Set(
      (existingQueueItems || []).map((q: any) =>
        `${q.payload.contact_id}|${(q.payload.label || "").toLowerCase()}|${(q.payload.value || "").toLowerCase()}`
      ),
    );

    const suggestions: Array<{
      user_id: string;
      source_note_id: string;
      suggestion_type: string;
      title: string;
      description: string;
      payload: Record<string, unknown>;
      status: string;
    }> = [];

    for (const fact of validFacts) {
      const contact = nameToContact.get(fact.contact_name.toLowerCase())!;
      const dedupKey = `${contact.contact_id}|${fact.label.toLowerCase()}|${fact.value.toLowerCase()}`;

      // Skip if entry already exists or already in queue
      if (entrySet.has(dedupKey) || queueSet.has(dedupKey)) continue;

      // Find category ID if categories are seeded
      const catRow = (existingCategories || []).find(
        (c: any) => c.slug === fact.category_slug && c.contact_id === contact.contact_id,
      );

      suggestions.push({
        user_id: userId,
        source_note_id: noteId,
        suggestion_type: "add_profile_entry",
        title: `Add to ${contact.canonical_name}'s profile: ${fact.label}`,
        description: `"${fact.value}" — extracted from "${noteTitle}"`,
        payload: {
          contact_id: contact.contact_id,
          contact_name: contact.canonical_name,
          category_slug: fact.category_slug,
          category_id: catRow?.id || null,
          label: fact.label,
          value: fact.value,
        },
        status: "pending",
      });

      // Track to avoid duplicates within same batch
      queueSet.add(dedupKey);
    }

    if (suggestions.length > 0) {
      const { error } = await supabase.from("review_queue").insert(suggestions);
      if (error) console.error("Profile suggestion insert error:", error);
      else console.log(`Created ${suggestions.length} profile suggestions for note ${noteId}`);
    } else {
      console.log(`All profile facts already known for note ${noteId}`);
    }

    // ── Relationship suggestions ──
    if (extractedRelationships.length > 0) {
      const relSuggestions: typeof suggestions = [];

      // Check existing relationship review queue items
      const { data: existingRelQueue } = await supabase
        .from("review_queue")
        .select("title, status")
        .eq("user_id", userId)
        .eq("suggestion_type", "add_relationship")
        .in("status", ["pending", "accepted", "dismissed"]);

      const relQueueSet = new Set(
        (existingRelQueue || []).map((q: any) => q.title)
      );

      for (const rel of extractedRelationships) {
        // Resolve person_a and person_b to contacts
        const isSelfA = /^(me|myself|i)$/i.test(rel.person_a);
        const isSelfB = /^(me|myself|i)$/i.test(rel.person_b);

        let contactA: { id: string; name: string } | null = null;
        let contactB: { id: string; name: string } | null = null;

        if (!isSelfA) {
          // Find contact for person_a
          const matchA = nameToContact.get(rel.person_a.toLowerCase());
          if (matchA) contactA = { id: matchA.contact_id, name: matchA.canonical_name };
          else {
            // Fuzzy match
            for (const [key, c] of nameToContact) {
              if (isFuzzyMatch(rel.person_a, key)) {
                contactA = { id: c.contact_id, name: c.canonical_name };
                break;
              }
            }
          }
          if (!contactA) {
            console.log(`[relationships] Skipping: cannot match person_a="${rel.person_a}"`);
            continue;
          }
        }

        if (!isSelfB) {
          const matchB = nameToContact.get(rel.person_b.toLowerCase());
          if (matchB) contactB = { id: matchB.contact_id, name: matchB.canonical_name };
          else {
            for (const [key, c] of nameToContact) {
              if (isFuzzyMatch(rel.person_b, key)) {
                contactB = { id: c.contact_id, name: c.canonical_name };
                break;
              }
            }
          }
          if (!contactB) {
            console.log(`[relationships] Skipping: cannot match person_b="${rel.person_b}"`);
            continue;
          }
        }

        // Can't have both be self
        if (isSelfA && isSelfB) continue;

        const nameA = isSelfA ? "Me" : contactA!.name;
        const nameB = isSelfB ? "Me" : contactB!.name;
        const title = `Add relationship: ${nameA} → ${nameB} (${rel.label_a_to_b})`;

        if (relQueueSet.has(title)) continue;

        relSuggestions.push({
          user_id: userId,
          source_note_id: noteId,
          suggestion_type: "add_relationship",
          title,
          description: `${nameA} is ${rel.label_a_to_b} of ${nameB}`,
          payload: {
            source_type: isSelfA ? "self" : "contact",
            source_id: isSelfA ? null : contactA!.id,
            target_type: isSelfB ? "self" : "contact",
            target_id: isSelfB ? null : contactB!.id,
            label: rel.label_a_to_b,
            inverse_label: rel.label_b_to_a,
            inverse_source_type: isSelfB ? "self" : "contact",
            inverse_source_id: isSelfB ? null : contactB!.id,
            inverse_target_type: isSelfA ? "self" : "contact",
            inverse_target_id: isSelfA ? null : contactA!.id,
            contact_name_a: nameA,
            contact_name_b: nameB,
          },
          status: "pending",
        });
        relQueueSet.add(title);
      }

      if (relSuggestions.length > 0) {
        const { error } = await supabase.from("review_queue").insert(relSuggestions);
        if (error) console.error("Relationship suggestion insert error:", error);
        else console.log(`Created ${relSuggestions.length} relationship suggestions for note ${noteId}`);
      }
    }
  } catch (err) {
    console.error("generateProfileSuggestions error:", err);
  }
}

/* ── Main background processor ── */
async function processInBackground(noteId: string, authHeader: string) {
  try {
    const { data: note, error: fetchErr } = await supabase
      .from("notes")
      .select("id, title, content, user_id, metadata")
      .eq("id", noteId)
      .single();

    if (fetchErr || !note) {
      console.error("Note not found:", noteId);
      return;
    }

    let fullText = `${note.title}\n\n${note.content}`.trim();
    if (!fullText) return;

    // Include media analysis content in the embedding text
    const { data: mediaEntries } = await supabase
      .from("media_analysis")
      .select("extracted_text, description, topics")
      .eq("note_id", noteId)
      .eq("analysis_status", "complete");

    const mediaTopics: string[] = [];
    if (mediaEntries && mediaEntries.length > 0) {
      const mediaTexts = mediaEntries.map((m: any) => {
        if (m.topics) mediaTopics.push(...m.topics);
        return [m.description, m.extracted_text].filter(Boolean).join(" ");
      });
      fullText += "\n\n[Media content]\n" + mediaTexts.join("\n");
    }

    // Pre-check balance before making any LLM calls
    const balance = await checkBalance(supabase, note.user_id);
    if (!balance.allowed) {
      console.log(`Skipping AI processing for note ${noteId}: insufficient credits for user ${note.user_id}`);
      return;
    }

    // Generate embedding and extract metadata in parallel (each deducts tokens)
    let embedding: number[] | null = null;
    let metadata: Record<string, unknown> = {};
    let lastCredits: any = null;

    try {
      const [embResult, chatResult] = await Promise.all([
        getEmbeddingWithCredits(supabase, OPENROUTER_API_KEY, note.user_id, "process-note", fullText),
        chatWithCredits(
          supabase, OPENROUTER_API_KEY, note.user_id, "process-note",
          [
            { role: "system", content: METADATA_SYSTEM_PROMPT },
            { role: "user", content: fullText },
          ],
          { response_format: { type: "json_object" } }
        ),
      ]);

      embedding = embResult.embedding;
      lastCredits = chatResult.credits;

      try {
        metadata = JSON.parse(chatResult.result.choices[0].message.content);
      } catch {
        metadata = { topics: ["uncategorized"], type: "observation", sentiment: "neutral" };
      }
    } catch (err: any) {
      if (err.message === "INSUFFICIENT_CREDITS") {
        console.log(`Credit limit reached during processing of note ${noteId}`);
        return;
      }
      throw err;
    }

    // Merge media-derived topics into note metadata
    if (mediaTopics.length > 0 && Array.isArray(metadata.topics)) {
      const existingTopics = metadata.topics as string[];
      const merged = [...new Set([...existingTopics, ...mediaTopics])];
      metadata.topics = merged;
    }

    // Auto-link metadata people to contacts (alias-aware)
    const metadataPeople = Array.isArray(metadata.people) ? metadata.people as string[] : [];
    const contactMap: Record<string, string> = {};
    const matchedPeople: Array<{ name: string; contact_id: string; canonical_name: string }> = [];

    if (metadataPeople.length > 0) {
      const { data: allContacts } = await supabase
        .from("contacts")
        .select("id, name, aliases")
        .eq("user_id", note.user_id)
        .is("merged_into", null);

      const nameToContact = new Map<string, { id: string; name: string }>();
      for (const c of (allContacts || []) as any[]) {
        nameToContact.set(c.name.toLowerCase(), { id: c.id, name: c.name });
        if (Array.isArray(c.aliases)) {
          for (const alias of c.aliases) {
            if (alias) nameToContact.set(alias.toLowerCase(), { id: c.id, name: c.name });
          }
        }
      }

      for (const person of metadataPeople) {
        // Exact match first
        const exactMatch = nameToContact.get(person.toLowerCase());
        if (exactMatch) {
          matchedPeople.push({ name: person, contact_id: exactMatch.id, canonical_name: exactMatch.name });
          continue;
        }
        // Fuzzy match — treat as matched to existing contact
        for (const [key, contact] of nameToContact) {
          if (isFuzzyMatch(person, key)) {
            matchedPeople.push({ name: person, contact_id: contact.id, canonical_name: contact.name });
            break;
          }
        }
      }
      if (matchedPeople.length > 0) {
        metadata.matched_people = matchedPeople;
      }

      // Build contact map for action items
      for (const [name, contact] of nameToContact) {
        contactMap[name] = contact.id;
      }
    }

    // Only use AI-generated title for quick-capture notes (where the user didn't write the title).
    // Never overwrite a user-authored title.
    const existingMeta = note.metadata as Record<string, unknown> | null;
    const isQuickCapture = existingMeta?.is_quick_capture === true;
    const aiTitle = isQuickCapture && typeof metadata.title === "string" && metadata.title.trim()
      ? metadata.title.trim()
      : null;

    // Update the note with embedding, metadata, and optionally a smarter title
    const updatePayload: Record<string, unknown> = { embedding, metadata };
    if (aiTitle) updatePayload.title = aiTitle;

    const { error: updateErr } = await supabase
      .from("notes")
      .update(updatePayload)
      .eq("id", noteId);

    if (updateErr) {
      console.error("Update error:", updateErr);
      return;
    }

    // Action items extraction removed

    // Generate review queue suggestions (no extra LLM calls)
    await generateReviewItems(note.user_id, noteId, note.title, note.content, metadata);

    // Generate profile suggestions for matched people (one extra LLM call)
    await generateProfileSuggestions(note.user_id, noteId, note.title, note.content, matchedPeople);

    // Trigger connection computation (fire-and-forget)
    const computeUrl = `${SUPABASE_URL}/functions/v1/compute-connections`;
    fetch(computeUrl, {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ note_id: noteId }),
    }).catch(err => console.error("compute-connections trigger error:", err));

    console.log("process-note completed for:", noteId, "remaining credits:", lastCredits?.remaining_credits);
  } catch (err) {
    console.error("Background processing error:", err);
  }
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { note_id } = await req.json();
    if (!note_id) {
      return new Response(JSON.stringify({ error: "note_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // @ts-expect-error EdgeRuntime is a Supabase global not in TS scope
    EdgeRuntime.waitUntil(processInBackground(note_id, authHeader));

    return new Response(JSON.stringify({ ok: true, processing: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Function error:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
