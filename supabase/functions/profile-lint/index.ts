import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "npm:zod@3.25.76";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { canonicalLabel } from "../_shared/relationship-canonical.ts";
import { isBlockedRelationshipLabel, profileValueDecision } from "../_shared/profile-integrity.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const admin = createClient(supabaseUrl, serviceRoleKey);

const BodySchema = z.object({
  contact_id: z.string().uuid().nullable().optional(),
  repair: z.boolean().optional().default(false),
  queue_review: z.boolean().optional().default(true),
  scope: z.enum(["user", "all_users"]).optional().default("user"),
});

type RelationshipRow = {
  id: string;
  user_id: string;
  source_type: string;
  source_id: string | null;
  target_type: string;
  target_id: string | null;
  label: string;
  custom_label: string | null;
  pair_key?: string | null;
};

type ContactRow = { id: string; name: string | null };

type Violation = { id: string; reason: string; label: string; value?: string };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

async function authenticate(req: Request): Promise<{ userId: string | null; isService: boolean }> {
  // Nightly cron authenticates with a dedicated shared key, never the service role key.
  const cronKey = Deno.env.get("PROFILE_LINT_CRON_KEY") || "";
  const presented = req.headers.get("x-cron-key") || "";
  if (cronKey && presented && presented === cronKey) return { userId: null, isService: true };
  const auth = req.headers.get("Authorization");
  if (!auth) return { userId: null, isService: false };
  const token = auth.replace(/^Bearer\s+/i, "");
  if (serviceRoleKey && token === serviceRoleKey) return { userId: null, isService: true };
  const { data } = await admin.auth.getUser(token);
  return { userId: data.user?.id ?? null, isService: false };

}

const ROMANTIC = new Set(["wife", "husband", "spouse", "partner", "lover"]);

/** Coarse family of a canonical role — two labels in the same family are not a conflict. */
function bondFamily(label: string): string {
  if (ROMANTIC.has(label)) return "romantic";
  if (["mother", "father", "parent"].includes(label)) return "parent";
  if (["child", "son", "daughter"].includes(label)) return "child";
  if (["sibling", "brother", "sister"].includes(label)) return "sibling";
  if (["friend", "co-worker", "colleague", "manager", "employer", "employee"].includes(label)) return "social";
  return label;
}

function personPairKey(row: RelationshipRow): string {
  const a = `${row.source_type}:${row.source_id || "self"}`;
  const b = `${row.target_type}:${row.target_id || "self"}`;
  return [a, b].sort().join("|");
}

function normalizeName(name: string | null | undefined): string {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9\u00c0-\u024f\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function lintUser(userId: string, contactId: string | null, repair: boolean, queueReview: boolean) {
  const [relationshipsResult, entriesResult, contactsResult] = await Promise.all([
    admin.from("contact_relationships").select("id,user_id,source_type,source_id,target_type,target_id,label,custom_label,pair_key").eq("user_id", userId),
    admin.from("profile_entries").select("id,contact_id,category_id,label,value").eq("user_id", userId),
    admin.from("contacts").select("id,name").eq("user_id", userId),
  ]);
  if (relationshipsResult.error) throw relationshipsResult.error;
  if (entriesResult.error) throw entriesResult.error;
  if (contactsResult.error) throw contactsResult.error;

  const relationships = (relationshipsResult.data || []) as RelationshipRow[];
  const entries = (entriesResult.data || []) as Array<{ id: string; contact_id: string | null; category_id: string; label: string; value: string }>;
  const contacts = (contactsResult.data || []) as ContactRow[];
  const contactName = new Map(contacts.map((c) => [c.id, c.name || "Unnamed"]));

  const relationshipViolations: Violation[] = [];
  const seenPairs = new Set<string>();
  const byPersonPair = new Map<string, RelationshipRow[]>();

  for (const row of relationships) {
    if (contactId && row.source_id !== contactId && row.target_id !== contactId) continue;
    const label = canonicalLabel(row.label);
    if (isBlockedRelationshipLabel(label)) {
      relationshipViolations.push({ id: row.id, reason: "blocked_relationship_label", label: row.label });
      continue;
    }
    if ((row.source_type === row.target_type && row.source_id && row.source_id === row.target_id) || (row.source_type === "self" && row.target_type === "self")) {
      relationshipViolations.push({ id: row.id, reason: "self_relationship", label: row.label });
      continue;
    }
    if (row.pair_key && seenPairs.has(row.pair_key)) {
      relationshipViolations.push({ id: row.id, reason: "duplicate_pair", label: row.label });
      continue;
    }
    if (row.pair_key) seenPairs.add(row.pair_key);
    const key = personPairKey(row);
    const list = byPersonPair.get(key) || [];
    list.push(row);
    byPersonPair.set(key, list);
  }

  const profileViolations: Violation[] = [];
  for (const row of entries) {
    if (contactId && row.contact_id !== contactId) continue;
    const decision = profileValueDecision("", row.label, row.value);
    if (!decision.ok) profileViolations.push({ id: row.id, reason: decision.reason, label: row.label, value: row.value });
  }

  // ---- needs_review classification -------------------------------------
  const needsReview: Array<{ type: string; title: string; description: string; payload: Record<string, unknown>; suppression_key: string; target_entity_type?: string; target_entity_id?: string }> = [];

  // 1) Contradicting roles for the SAME person pair (different role families).
  //    Multiple partners live on different pairs and are never flagged.
  for (const [, rows] of byPersonPair) {
    const families = new Map<string, RelationshipRow>();
    for (const row of rows) families.set(bondFamily(canonicalLabel(row.label)), row);
    if (families.size < 2) continue;
    const involved = rows[0];
    const nameA = involved.source_type === "self" ? "You" : contactName.get(involved.source_id || "") || "Unknown";
    const nameB = involved.target_type === "self" ? "You" : contactName.get(involved.target_id || "") || "Unknown";
    const labels = [...new Set(rows.map((r) => canonicalLabel(r.label)))].sort();
    needsReview.push({
      type: "resolve_relationship_conflict",
      title: `Conflicting roles: ${nameA} & ${nameB}`,
      description: `Both "${labels.join('" and "')}" are recorded for the same two people. Pick the one that is right.`,
      payload: {
        options: rows.map((r) => ({ id: r.id, label: canonicalLabel(r.label), custom_label: r.custom_label })),
        person_a: nameA,
        person_b: nameB,
      },
      suppression_key: `relationship_conflict:${personPairKey(involved)}:${labels.join("|")}`,
    });
  }

  // 2) Duplicate people (same normalized name).
  const byName = new Map<string, ContactRow[]>();
  for (const c of contacts) {
    const key = normalizeName(c.name);
    if (!key) continue;
    if (contactId && c.id !== contactId) {
      // still needed to detect a duplicate of the linted contact
    }
    const list = byName.get(key) || [];
    list.push(c);
    byName.set(key, list);
  }
  for (const [key, group] of byName) {
    if (group.length < 2) continue;
    if (contactId && !group.some((c) => c.id === contactId)) continue;
    const ids = group.map((c) => c.id).sort();
    needsReview.push({
      type: "merge_duplicate_person",
      title: `Possible duplicate: ${group[0].name}`,
      description: `${group.length} people share the name "${group[0].name}". Merge them into one record if they are the same person.`,
      payload: {
        name: group[0].name,
        contact_ids: ids,
        keep_contact_id: ids[0],
        merge_contact_ids: ids.slice(1),
      },
      suppression_key: `duplicate_person:${key}:${ids.join("|")}`,
      target_entity_type: "contact",
      target_entity_id: ids[0],
    });
  }

  let queued = 0;
  if (queueReview && needsReview.length > 0) {
    const keys = needsReview.map((n) => n.suppression_key);
    const { data: existing } = await admin
      .from("review_queue")
      .select("suppression_key")
      .eq("user_id", userId)
      .in("suppression_key", keys);
    const seen = new Set((existing || []).map((r: { suppression_key: string | null }) => r.suppression_key || ""));
    const { data: suppressed } = await admin
      .from("ai_suggestion_suppressions")
      .select("suppression_key")
      .eq("user_id", userId)
      .in("suppression_key", keys);
    for (const s of suppressed || []) seen.add((s as { suppression_key: string | null }).suppression_key || "");
    const rows = needsReview
      .filter((n) => !seen.has(n.suppression_key))
      .map((n) => ({
        user_id: userId,
        suggestion_type: n.type,
        title: n.title,
        description: n.description,
        payload: n.payload,
        status: "pending_review",
        suppression_key: n.suppression_key,
        target_entity_type: n.target_entity_type ?? null,
        target_entity_id: n.target_entity_id ?? null,
      }));
    if (rows.length) {
      const { error } = await admin.from("review_queue").insert(rows);
      if (error) console.error("[profile-lint] queue insert failed", error);
      else queued = rows.length;
    }
  }

  const repaired = { relationships: 0, profile_entries: 0 };
  if (repair) {
    const relationshipIds = relationshipViolations
      .filter((v) => ["blocked_relationship_label", "self_relationship", "duplicate_pair"].includes(v.reason))
      .map((v) => v.id);
    if (relationshipIds.length) {
      const { error } = await admin.from("contact_relationships").delete().eq("user_id", userId).in("id", relationshipIds);
      if (error) throw error;
      repaired.relationships = relationshipIds.length;
    }
    const profileIds = profileViolations.map((v) => v.id);
    if (profileIds.length) {
      const { error } = await admin.from("profile_entries").delete().eq("user_id", userId).in("id", profileIds);
      if (error) throw error;
      repaired.profile_entries = profileIds.length;
    }
  }

  return {
    user_id: userId,
    violations: { relationships: relationshipViolations, profile_entries: profileViolations },
    needs_review: needsReview.length,
    queued,
    repaired,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);
  const { userId, isService } = await authenticate(req);
  if (!userId && !isService) return json({ error: "Unauthorized" }, 401);

  try {
    const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return json({ error: parsed.error.flatten().fieldErrors }, 400);
    const { contact_id: contactId, repair, queue_review: queueReview, scope } = parsed.data;

    if (scope === "all_users") {
      if (!isService) return json({ error: "Forbidden" }, 403);
      const { data: profiles, error } = await admin.from("profiles").select("id");
      if (error) throw error;
      const ids = (profiles || []).map((p: { id: string }) => p.id);
      // Background: a full sweep must never block (or time out) the request.
      EdgeRuntime.waitUntil((async () => {
        for (const id of ids) {
          try {
            await lintUser(id, null, repair, queueReview);
          } catch (err) {
            console.error("[profile-lint] user sweep failed", id, err);
          }
        }
        console.log("[profile-lint] sweep complete", ids.length, "users");
      })());
      return json({ ok: true, scope, users: ids.length, background: true });
    }

    const result = await lintUser(userId!, contactId ?? null, repair, queueReview);
    return json({ ok: true, repair, ...result });
  } catch (error) {
    console.error("[profile-lint] failed", error);
    return json({ error: "Profile lint failed" }, 500);
  }
});
