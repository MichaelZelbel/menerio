// Creates person records from the user's notes and links notes to them.
//
// Runs synchronously and always reports a result, so the UI can say
// "Created 2 people, updated 1" or state a plain reason why nothing happened.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  describePeopleResult,
  planPeopleFromNotes,
  type ExistingContact,
  type PersonNoteSource,
} from "../_shared/people-import.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
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
    const { data: { user }, error: authErr } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", ""),
    );
    if (authErr || !user) return json({ error: "unauthorized" }, 401);

    const body = req.headers.get("content-type")?.includes("application/json")
      ? await req.json().catch(() => ({}))
      : {};
    const limit = Math.min(Math.max(Number(body.limit ?? 300), 1), 500);
    const noteIds: string[] | null = Array.isArray(body.note_ids) && body.note_ids.length
      ? body.note_ids.map(String)
      : null;

    let notesQuery = supabase
      .from("notes")
      .select("id, title, content, metadata")
      .eq("user_id", user.id)
      .eq("is_trashed", false)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (noteIds) notesQuery = notesQuery.in("id", noteIds);

    const [{ data: notes, error: notesErr }, { data: contacts }, { data: aliases }] = await Promise.all([
      notesQuery,
      supabase.from("contacts").select("id, name, aliases").eq("user_id", user.id).is("merged_into", null),
      supabase.from("user_self_aliases").select("alias").eq("user_id", user.id),
    ]);
    if (notesErr) throw notesErr;

    const selfAliases = ((aliases || []) as Array<{ alias: string }>).map((a) => a.alias).filter(Boolean);
    const plan = planPeopleFromNotes(
      (notes || []) as PersonNoteSource[],
      (contacts || []) as ExistingContact[],
      { selfAliases },
    );

    let created = 0;
    const createdNames: string[] = [];
    const failures: string[] = [];
    const noteLinks = new Map<string, Array<{ name: string; contact_id: string; canonical_name: string }>>();

    const registerLink = (noteId: string, contactId: string, name: string) => {
      const list = noteLinks.get(noteId) ?? [];
      if (!list.some((l) => l.contact_id === contactId)) {
        list.push({ name, contact_id: contactId, canonical_name: name });
      }
      noteLinks.set(noteId, list);
    };

    for (const person of plan.create) {
      const { data: inserted, error } = await supabase
        .from("contacts")
        .insert({ user_id: user.id, name: person.name, aliases: [], app_mappings: {} })
        .select("id, name")
        .single();
      if (error || !inserted) {
        failures.push(`${person.name}: ${error?.message ?? "insert failed"}`);
        continue;
      }
      created++;
      createdNames.push(inserted.name);
      for (const noteId of person.note_ids) registerLink(noteId, inserted.id, inserted.name);
    }

    for (const link of plan.link) {
      for (const noteId of link.note_ids) registerLink(noteId, link.contact_id, link.name);
    }

    // Link the notes back to the people they mention (metadata.matched_people
    // is what the People page and profile pipelines read).
    let notesLinked = 0;
    const noteById = new Map((notes || []).map((n: any) => [n.id, n]));
    for (const [noteId, people] of noteLinks) {
      const note = noteById.get(noteId);
      if (!note) continue;
      const metadata = (note.metadata || {}) as Record<string, unknown>;
      const existingMatches = Array.isArray(metadata.matched_people)
        ? (metadata.matched_people as Array<Record<string, unknown>>)
        : [];
      const merged = [...existingMatches];
      let changed = false;
      for (const p of people) {
        if (!merged.some((m) => m.contact_id === p.contact_id)) {
          merged.push(p);
          changed = true;
        }
      }
      if (!changed) continue;
      const { error } = await supabase
        .from("notes")
        .update({ metadata: { ...metadata, matched_people: merged } })
        .eq("id", noteId)
        .eq("user_id", user.id);
      if (!error) notesLinked++;
    }

    // Any pending "Add X to your People" suggestion for a person we just
    // created is now satisfied — don't leave it lingering in the review queue.
    if (createdNames.length > 0) {
      await supabase
        .from("review_queue")
        .update({ status: "kept", applied_at: new Date().toISOString() })
        .eq("user_id", user.id)
        .eq("suggestion_type", "add_contact")
        .in("status", ["pending", "pending_review", "auto_applied_unreviewed"])
        .in("extracted_value", createdNames);
    }

    const result = {
      ok: true,
      created,
      created_names: createdNames,
      linked: plan.link.length,
      notes_linked: notesLinked,
      notes_scanned: (notes || []).length,
      skipped: plan.skipped.length,
      failures,
      message: describePeopleResult({
        created,
        linked: plan.link.length,
        notes_scanned: (notes || []).length,
        skipped: plan.skipped.length,
      }),
    };
    console.log("[enrich-people]", user.id, result);
    return json(result);
  } catch (err) {
    console.error("enrich-people error:", err);
    return json({ error: err instanceof Error ? err.message : "Internal error" }, 500);
  }
});
