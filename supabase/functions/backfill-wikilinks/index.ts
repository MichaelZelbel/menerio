// Backfill manual_link rows in note_connections for all [[Title]] references
// found in existing notes. Idempotent: only inserts missing rows, never deletes.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const WIKILINK_REGEX = /\[\[([^[\]\n]+?)\]\]/g;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: notes, error: notesErr } = await supabase
      .from("notes")
      .select("id, title, content")
      .eq("user_id", user.id)
      .eq("is_trashed", false);

    if (notesErr) throw notesErr;

    const titleMap = new Map<string, string>();
    for (const n of notes ?? []) {
      if (!n.title) continue;
      const k = String(n.title).trim().toLowerCase();
      if (k && !titleMap.has(k)) titleMap.set(k, n.id);
    }

    // Existing manual_link pairs
    const { data: existing } = await supabase
      .from("note_connections")
      .select("source_note_id, target_note_id")
      .eq("user_id", user.id)
      .eq("connection_type", "manual_link");

    const existingPairs = new Set(
      (existing ?? []).map((r: any) => `${r.source_note_id}|${r.target_note_id}`)
    );

    const unresolved = new Set<string>();
    const toInsert: Array<{
      user_id: string;
      source_note_id: string;
      target_note_id: string;
      connection_type: string;
      strength: number;
      metadata: Record<string, unknown>;
    }> = [];
    const seenInBatch = new Set<string>();
    let scanned = 0;

    for (const n of notes ?? []) {
      scanned++;
      const content = String(n.content ?? "");
      if (!content.includes("[[")) continue;
      WIKILINK_REGEX.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = WIKILINK_REGEX.exec(content)) !== null) {
        const title = m[1].trim();
        if (!title) continue;
        const targetId = titleMap.get(title.toLowerCase());
        if (!targetId) {
          unresolved.add(title);
          continue;
        }
        if (targetId === n.id) continue;
        const key = `${n.id}|${targetId}`;
        if (existingPairs.has(key) || seenInBatch.has(key)) continue;
        seenInBatch.add(key);
        toInsert.push({
          user_id: user.id,
          source_note_id: n.id,
          target_note_id: targetId,
          connection_type: "manual_link",
          strength: 1.0,
          metadata: { source: "backfill-wikilinks" },
        });
      }
    }

    let inserted = 0;
    for (let i = 0; i < toInsert.length; i += 500) {
      const batch = toInsert.slice(i, i + 500);
      const { error } = await supabase
        .from("note_connections")
        .insert(batch);
      if (!error) inserted += batch.length;
      else console.error("insert batch failed", error);
    }

    return new Response(
      JSON.stringify({
        scanned,
        links_added: inserted,
        unresolved: [...unresolved].slice(0, 50),
        unresolved_count: unresolved.size,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("backfill-wikilinks error", err);
    return new Response(JSON.stringify({ error: err?.message ?? "unknown" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
