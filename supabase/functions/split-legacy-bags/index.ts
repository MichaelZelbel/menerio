// One-off, for the fact store go-live (docs/plans/one-fact-store.md, B6).
//
// The switch carried legacy "bags" (several facts in one value) over word for
// word. This splits each into single facts with writeFact's own splitter, and
// replaces the bag through split_legacy_bag(), which keeps the bag's origin,
// quote, source and dates. It is conservative:
//   - a bag a human typed (user_manual or preferred) is left as it is;
//   - a bag with any piece the splitter cannot file cleanly is left as it is,
//     so no words are ever dropped;
//   - relationships are never split out of a bag.
// Responds with counts only. Auth: the scheduler key. Run it from SQL:
//   select internal.call_edge('split-legacy-bags', '{}'::jsonb);
// Deleted after B6.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isValidCronRequest } from "../_shared/cron-auth.ts";
import { selectAllRows } from "../_shared/paged-select.ts";
import { planBagSplit } from "../_shared/bag-split.ts";

Deno.serve(async (req) => {
  if (!(await isValidCronRequest(req))) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
  const counts = { examined: 0, split: 0, pieces: 0, kept_human: 0, kept_unfileable: 0, failed: 0 };
  try {
    const rows = await selectAllRows<any>((from, to) =>
      db.from("profile_facts")
        .select("claim_id, user_id, subject_type, subject_id, attribute, value, origin, rank, label, category_slug")
        .is("valid_to", null).or("value.like.%,%,value.like.%;%")
        .order("claim_id").range(from, to)
    );
    for (const row of rows) {
      counts.examined += 1;
      const plan = planBagSplit(row);
      if (plan.kind === "keep_human") { counts.kept_human += 1; continue; }
      if (plan.kind !== "split") { counts.kept_unfileable += 1; continue; }
      const { data, error } = await db.rpc("split_legacy_bag", {
        p_user_id: row.user_id, p_claim_id: row.claim_id, p_pieces: plan.pieces,
      });
      if (error) { counts.failed += 1; console.error("[split-legacy-bags] split failed", error.code); continue; }
      if (Number(data) > 0) { counts.split += 1; counts.pieces += Number(data); }
    }
    console.log("[split-legacy-bags]", JSON.stringify(counts));
    return new Response(JSON.stringify(counts), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    console.error("[split-legacy-bags] failed", (e as Error).message);
    return new Response(JSON.stringify({ error: (e as Error).message, ...counts }), { status: 500 });
  }
});
