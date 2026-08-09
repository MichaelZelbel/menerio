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

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

async function authenticate(req: Request) {
  const auth = req.headers.get("Authorization");
  if (!auth) return null;
  const token = auth.replace(/^Bearer\s+/i, "");
  const { data } = await admin.auth.getUser(token);
  return data.user;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);
  const user = await authenticate(req);
  if (!user) return json({ error: "Unauthorized" }, 401);

  try {
    const parsed = BodySchema.safeParse(await req.json());
    if (!parsed.success) return json({ error: parsed.error.flatten().fieldErrors }, 400);
    const { contact_id: contactId, repair } = parsed.data;

    const [relationshipsResult, entriesResult] = await Promise.all([
      admin.from("contact_relationships").select("id,user_id,source_type,source_id,target_type,target_id,label,custom_label,pair_key").eq("user_id", user.id),
      admin.from("profile_entries").select("id,contact_id,category_id,label,value").eq("user_id", user.id),
    ]);
    if (relationshipsResult.error) throw relationshipsResult.error;
    if (entriesResult.error) throw entriesResult.error;

    const relationships = (relationshipsResult.data || []) as RelationshipRow[];
    const entries = (entriesResult.data || []) as Array<{ id: string; contact_id: string | null; category_id: string; label: string; value: string }>;
    const relationshipViolations: Array<{ id: string; reason: string; label: string }> = [];
    const seenPairs = new Set<string>();
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
      if (row.pair_key && seenPairs.has(row.pair_key)) relationshipViolations.push({ id: row.id, reason: "duplicate_pair", label: row.label });
      if (row.pair_key) seenPairs.add(row.pair_key);
    }

    const profileViolations: Array<{ id: string; reason: string; label: string; value: string }> = [];
    for (const row of entries) {
      const decision = profileValueDecision("", row.label, row.value);
      if (!decision.ok) profileViolations.push({ id: row.id, reason: decision.reason, label: row.label, value: row.value });
    }

    const repaired = { relationships: 0, profile_entries: 0 };
    if (repair) {
      const relationshipIds = relationshipViolations.filter((v) => ["blocked_relationship_label", "self_relationship", "duplicate_pair"].includes(v.reason)).map((v) => v.id);
      if (relationshipIds.length) {
        const { error } = await admin.from("contact_relationships").delete().eq("user_id", user.id).in("id", relationshipIds);
        if (error) throw error;
        repaired.relationships = relationshipIds.length;
      }
      const profileIds = profileViolations.map((v) => v.id);
      if (profileIds.length) {
        const { error } = await admin.from("profile_entries").delete().eq("user_id", user.id).in("id", profileIds);
        if (error) throw error;
        repaired.profile_entries = profileIds.length;
      }
    }

    return json({ ok: true, repair, violations: { relationships: relationshipViolations, profile_entries: profileViolations }, repaired });
  } catch (error) {
    console.error("[profile-lint] failed", error);
    return json({ error: "Profile lint failed" }, 500);
  }
});
