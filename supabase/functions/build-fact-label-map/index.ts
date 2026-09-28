// One-off, for the fact store switch (docs/plans/one-fact-store.md, A3, A6, B5).
//
// Reads every distinct entry label and claim attribute, and writes
// buildFactLabelMap()'s rows into public.fact_label_map, replacing what was
// there. Nothing is returned but counts, so no label leaves the database
// through this function (plan rule 5.1).
//
// Auth: the scheduler key only. Run it from SQL:
//   select internal.call_edge('build-fact-label-map', '{}'::jsonb);
// Deleted in B6 together with the table.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isValidCronRequest } from "../_shared/cron-auth.ts";
import { buildFactLabelMap } from "../_shared/fact-label-map.ts";

const PAGE = 1000;

async function distinctColumn(db: any, table: string, column: string): Promise<string[]> {
  const seen = new Set<string>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db.from(table).select(column).order("id").range(from, from + PAGE - 1);
    if (error) throw new Error(`read ${table}: ${error.message}`);
    for (const row of data ?? []) seen.add(String(row[column] ?? ""));
    if (!data || data.length < PAGE) break;
  }
  return [...seen];
}

Deno.serve(async (req) => {
  if (!(await isValidCronRequest(req))) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  try {
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false },
    });
    const labels = await distinctColumn(db, "profile_entries", "label");
    const attributes = await distinctColumn(db, "claims", "attribute");
    const rows = buildFactLabelMap(labels, attributes);

    const { error: clearError } = await db.from("fact_label_map").delete().neq("kind", "");
    if (clearError) throw new Error(`clear fact_label_map: ${clearError.message}`);
    for (let i = 0; i < rows.length; i += PAGE) {
      const { error } = await db.from("fact_label_map").insert(rows.slice(i, i + PAGE));
      if (error) throw new Error(`write fact_label_map: ${error.message}`);
    }
    const counts = { labels: labels.length, attributes: attributes.length, rows: rows.length };
    console.log("[build-fact-label-map]", JSON.stringify(counts));
    return new Response(JSON.stringify(counts), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    // Messages name tables, never a label or a value.
    console.error("[build-fact-label-map] failed", (e as Error).message);
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500 });
  }
});
