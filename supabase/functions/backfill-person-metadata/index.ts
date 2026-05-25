// Backfill person-profile note metadata so the knowledge graph links person nodes
// to every note that mentions them.
//
// For each contact (name + aliases), we look for a note whose title matches the
// contact's name or any alias (case-insensitive, exact). When found we:
//   - set metadata.type = 'person_note'
//   - ensure metadata.people contains the contact's name and every alias
//
// Idempotent: existing person notes get re-synced with the latest aliases.
//
// POST body: { user_id?: string }  (defaults to the caller)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) return json({ error: "unauthorized" }, 401);

    const userId = user.id;

    const { data: contacts } = await supabase
      .from("contacts")
      .select("id, name, aliases")
      .eq("user_id", userId);

    const { data: notes } = await supabase
      .from("notes")
      .select("id, title, metadata")
      .eq("user_id", userId)
      .eq("is_trashed", false);

    if (!contacts?.length || !notes?.length) {
      return json({ ok: true, updated: 0, reason: "nothing to do" });
    }

    // Map lowercased title -> note for fast lookup.
    const notesByTitle = new Map<string, typeof notes[number]>();
    for (const n of notes) {
      const key = (n.title || "").trim().toLowerCase();
      if (key && !notesByTitle.has(key)) notesByTitle.set(key, n);
    }

    let updated = 0;
    const updates: { id: string; title: string; canonical: string }[] = [];

    for (const c of contacts) {
      const variants = [c.name, ...((c.aliases as string[]) || [])]
        .filter(Boolean)
        .map((v) => String(v).trim());
      const lowerVariants = variants.map((v) => v.toLowerCase());

      // Find any note whose title matches the contact name or an alias.
      let match: typeof notes[number] | undefined;
      for (const v of lowerVariants) {
        const n = notesByTitle.get(v);
        if (n) { match = n; break; }
      }
      if (!match) continue;

      const meta = (match.metadata || {}) as Record<string, unknown>;
      const existingPeople = Array.isArray(meta.people) ? (meta.people as string[]) : [];
      const mergedPeople = Array.from(
        new Set([...existingPeople, ...variants].filter(Boolean).map((s) => s.trim())),
      );

      const next = {
        ...meta,
        type: "person_note",
        people: mergedPeople,
      };

      const { error } = await supabase
        .from("notes")
        .update({ metadata: next })
        .eq("id", match.id)
        .eq("user_id", userId);

      if (!error) {
        updated++;
        updates.push({ id: match.id, title: match.title, canonical: c.name });
      } else {
        console.error("update failed", match.id, error.message);
      }
    }

    return json({ ok: true, updated, contacts: contacts.length, notes_scanned: notes.length, updates });
  } catch (err) {
    console.error("backfill-person-metadata error:", err);
    return json({ error: err instanceof Error ? err.message : "An unknown error occurred" }, 500);
  }
});
