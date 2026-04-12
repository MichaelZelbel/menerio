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

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const METADATA_SYSTEM_PROMPT = `Extract metadata from the user's note. Return JSON with:
- "title": If the first line of the note is 10 words or fewer and reads like a natural title or heading, use it verbatim. Otherwise, generate a concise title (max 8 words) that captures the essence of the note.
- "people": array of people mentioned (empty if none)
- "action_items": array of implied to-dos (empty if none)
- "dates_mentioned": array of dates in YYYY-MM-DD format (empty if none)
- "topics": array of 1-5 short topic tags (always generate at least one)
- "type": one of "observation", "task", "idea", "reference", "person_note", "meeting_note", "decision", "project"
- "sentiment": one of "positive", "negative", "neutral"
- "summary": one-sentence summary of the note
Only extract what's explicitly there. Don't invent details.`;

const PROFILE_CATEGORY_SLUGS = [
  "identity", "location", "professional", "relationships",
  "communication", "personality", "hobbies", "food", "travel", "preferences",
];

const PROFILE_EXTRACTION_PROMPT = `You are analyzing a note that mentions specific people. For each person listed, extract any profile-worthy facts from the note content.

Return a JSON array of objects, each with:
- "contact_name": the person's name exactly as provided
- "category_slug": one of: ${PROFILE_CATEGORY_SLUGS.join(", ")}
- "label": a short label for the fact (e.g. "Favorite cuisine", "Current city", "Job title")
- "value": the actual value (e.g. "Japanese", "Berlin", "Software Engineer")

Rules:
- Only extract facts that are clearly stated or strongly implied in the note
- Do NOT invent or assume facts
- Skip vague or uncertain information
- Each fact should be a distinct, specific piece of information
- Return an empty array if no profile-worthy facts are found
- Keep labels concise (2-4 words)
- Keep values concise but complete`;

/* ── Review Queue suggestion generator ── */
async function generateReviewItems(
  userId: string,
  noteId: string,
  noteTitle: string,
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

      for (const person of people) {
        if (!nameToContact.has(person.toLowerCase())) {
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
    const userPrompt = `People mentioned: ${peopleList}\n\nNote title: ${noteTitle}\nNote content:\n${noteContent}`;

    let extractedFacts: Array<{
      contact_name: string;
      category_slug: string;
      label: string;
      value: string;
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

      const parsed = JSON.parse(result.result.choices[0].message.content);
      // Handle both { facts: [...] } and direct array formats
      extractedFacts = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.facts) ? parsed.facts : []);
    } catch (err: any) {
      if (err.message === "INSUFFICIENT_CREDITS") {
        console.log(`Credit limit reached during profile extraction for note ${noteId}`);
        return;
      }
      console.error("Profile extraction LLM error:", err);
      return;
    }

    if (extractedFacts.length === 0) {
      console.log(`No profile facts extracted from note ${noteId}`);
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

    const validFacts = extractedFacts.filter((f) =>
      f.contact_name &&
      f.category_slug &&
      f.label &&
      f.value &&
      PROFILE_CATEGORY_SLUGS.includes(f.category_slug) &&
      nameToContact.has(f.contact_name.toLowerCase())
    );

    if (validFacts.length === 0) {
      console.log(`No valid profile facts after filtering for note ${noteId}`);
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
  } catch (err) {
    console.error("generateProfileSuggestions error:", err);
  }
}

/* ── Main background processor ── */
async function processInBackground(noteId: string, authHeader: string) {
  try {
    const { data: note, error: fetchErr } = await supabase
      .from("notes")
      .select("id, title, content, user_id")
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
        .eq("user_id", note.user_id);

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
        const match = nameToContact.get(person.toLowerCase());
        if (match) {
          matchedPeople.push({ name: person, contact_id: match.id, canonical_name: match.name });
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

    // Use AI-generated title if available
    const aiTitle = typeof metadata.title === "string" && metadata.title.trim()
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

    // Insert extracted action items into the action_items table
    const actionItems = Array.isArray(metadata.action_items) ? metadata.action_items as string[] : [];
    if (actionItems.length > 0) {
      const rows = actionItems.map((content: string) => {
        let contact_id: string | null = null;
        for (const [name, id] of Object.entries(contactMap)) {
          if (content.toLowerCase().includes(name)) {
            contact_id = id;
            break;
          }
        }
        return {
          user_id: note.user_id,
          content,
          source_note_id: noteId,
          contact_id,
          status: "open",
          priority: "normal",
        };
      });

      const { error: aiError } = await supabase.from("action_items").insert(rows);
      if (aiError) console.error("Action items insert error:", aiError);
    }

    // Generate review queue suggestions (no extra LLM calls)
    await generateReviewItems(note.user_id, noteId, note.title, metadata);

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
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
