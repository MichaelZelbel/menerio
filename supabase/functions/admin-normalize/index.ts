// Admin-only normalization runner. Uses a shared secret so the operator (or
// pg_cron) can trigger normalization for a specific user without a real user
// JWT. Never expose this key to the frontend.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import {
  applyNormalization,
  createNormalizationSuggestions,
} from "../_shared/profile-normalization.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-admin-key",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function getProfileInputHash(db: any, userId: string, contactId: string | null) {
  let q = db
    .from("profile_entries")
    .select("id, category_id, label, value, sort_order, linked_note_id, updated_at, created_at")
    .eq("user_id", userId)
    .order("id", { ascending: true });
  q = contactId ? q.eq("contact_id", contactId) : q.is("contact_id", null);
  const { data, error } = await q;
  if (error) throw error;
  return sha256Hex(JSON.stringify(data || []));
}

async function writeRunState(db: any, userId: string, contactId: string | null, values: Record<string, unknown>) {
  const subjectType = contactId ? "contact" : "owner";
  const base = db
    .from("profile_normalization_runs")
    .select("id")
    .eq("user_id", userId)
    .eq("subject_type", subjectType)
    .limit(1);
  const { data: existing } = contactId
    ? await base.eq("contact_id", contactId).maybeSingle()
    : await base.is("contact_id", null).maybeSingle();
  const payload = { user_id: userId, contact_id: contactId, subject_type: subjectType, ...values };
  if (existing?.id) {
    await db.from("profile_normalization_runs").update(payload).eq("id", existing.id);
  } else {
    await db.from("profile_normalization_runs").insert(payload);
  }
}

async function getPrefs(db: any, userId: string) {
  const { data } = await db
    .from("ai_suggestion_preferences")
    .select("suggestion_mode, suggestion_sensitivity, auto_add_sensitive")
    .eq("user_id", userId)
    .maybeSingle();
  return {
    mode: (data as any)?.suggestion_mode || "auto",
    sensitivity: (data as any)?.suggestion_sensitivity || "balanced",
    autoAddSensitive: (data as any)?.auto_add_sensitive === true,
  };
}

// Minimal helper set. Auto-apply every LLM group at >=0.9 confidence; the
// deterministic passes auto-apply themselves via `auto_apply_direct` inside
// the shared module.
function makeHelpers(db: any) {
  return {
    filterSuppressedSuggestions: async (_uid: string, s: any[]) => s,
    prepareSuggestionForInsert: async (suggestion: any) => {
      if (suggestion.suggestion_type !== "normalize_profile_entry") {
        return { ...suggestion, status: "pending_review" };
      }
      const confidence = suggestion.confidence_score ?? 0;
      if (confidence < 0.9) return { ...suggestion, status: "pending_review" };
      try {
        const result = await applyNormalization(db, suggestion.payload);
        if (result.ok && result.entryId) {
          return {
            ...suggestion,
            status: "auto_applied_unreviewed",
            target_entity_id: result.entryId,
            applied_at: new Date().toISOString(),
          };
        }
      } catch (e) {
        console.error("[admin-normalize] auto-apply failed:", e);
      }
      return { ...suggestion, status: "pending_review" };
    },
    isSensitiveSuggestion: () => false,
    buildSuppressionKey: () => "",
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const adminKey = Deno.env.get("MCP_ACCESS_KEY");
    if (!adminKey) return json({ error: "MCP_ACCESS_KEY not configured" }, 500);
    const provided = req.headers.get("x-admin-key") || "";
    if (provided !== adminKey) return json({ error: "forbidden" }, 403);

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const db = createClient(SUPABASE_URL, SERVICE_ROLE);

    const body = await req.json().catch(() => ({}));
    const userId = String(body?.user_id || Deno.env.get("BRAIN_OWNER_USER_ID") || "");
    if (!userId) return json({ error: "user_id required" }, 400);
    const scope = String(body?.scope || "all");
    const includeNotesContext = body?.includeNotesContext !== false;

    const subjects: Array<string | null> = [];
    if (scope === "owner") subjects.push(null);
    else if (scope === "contact") {
      const cid = String(body?.contact_id || "");
      if (!cid) return json({ error: "contact_id required" }, 400);
      subjects.push(cid);
    } else {
      // "all" (default): owner + all live contacts
      subjects.push(null);
      const { data: contacts } = await db
        .from("contacts")
        .select("id")
        .eq("user_id", userId)
        .is("merged_into", null)
        .limit(1000);
      for (const c of (contacts || []) as any[]) subjects.push(c.id);
    }

    const preferences = await getPrefs(db, userId);
    const helpers = makeHelpers(db);

    const runAll = async () => {
      for (const subj of subjects) {
        const inputHash = await getProfileInputHash(db, userId, subj);
        await writeRunState(db, userId, subj, {
          input_hash: inputHash,
          status: "running",
          started_at: new Date().toISOString(),
          completed_at: null,
          error_message: null,
        });
        try {
          const agg = { created: 0, autoApplied: 0, planned: 0, applied: 0, review: 0, skipped: 0 };
          for (let pass = 0; pass < 3; pass += 1) {
            const r = await createNormalizationSuggestions({
              supabase: db,
              userId,
              contactId: subj,
              preferences,
              sourceNoteId: null,
              includeNotesContext,
              helpers,
            });
            agg.created += r.created;
            agg.autoApplied += r.autoApplied;
            agg.planned += r.planned;
            agg.applied += r.applied;
            agg.review += r.review;
            agg.skipped += r.skipped;
            if (r.applied === 0 || r.planned === 0) break;
          }
          const completedHash = await getProfileInputHash(db, userId, subj);
          await writeRunState(db, userId, subj, {
            input_hash: completedHash,
            status: "completed",
            planned_count: agg.planned,
            applied_count: agg.applied,
            review_count: agg.review,
            skipped_count: agg.skipped,
            completed_at: new Date().toISOString(),
          });
          console.log(`[admin-normalize] subject=${subj ?? "owner"} done`, agg);
        } catch (e) {
          const msg = String(e);
          await writeRunState(db, userId, subj, {
            status: "failed",
            error_message: msg,
            completed_at: new Date().toISOString(),
          });
          console.error(`[admin-normalize] subject=${subj ?? "owner"} failed`, msg);
        }
      }
    };

    try {
      // @ts-expect-error - EdgeRuntime is a Supabase Edge global
      EdgeRuntime.waitUntil(runAll());
    } catch {
      runAll();
    }
    return json({ ok: true, started: true, subjectCount: subjects.length }, 202);
  } catch (err) {
    console.error("[admin-normalize] error:", err);
    return json({ error: String(err) }, 500);
  }
});
