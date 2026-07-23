import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import {
  applyNormalization,
  createNormalizationSuggestions,
  planSubjectNormalization,
  rollbackNormalization,
  type NormalizationPayload,
} from "../_shared/profile-normalization.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type SubjectRunResult = {
  subject: string;
  input_hash: string;
  completed_hash?: string;
  status: "completed" | "failed" | "skipped";
  created: number;
  autoApplied: number;
  planned: number;
  applied: number;
  review: number;
  skipped: number;
  error?: string;
};

const SENSITIVE_TERMS = [
  "medical", "health", "diagnosis", "condition", "therapy", "depression", "anxiety", "mental",
  "pregnant", "pregnancy", "romantic", "sexual", "affair", "secret", "conflict", "legal", "lawsuit",
  "debt", "bankrupt", "financial hardship", "broke", "divorce", "addiction", "trauma",
];

function normalizeSuggestionValue(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value.trim().toLowerCase();
  try { return JSON.stringify(value).toLowerCase(); } catch { return String(value).toLowerCase(); }
}
function buildSuppressionKey(suggestionType: string, targetEntityType: string | null, targetEntityId: string | null, value: unknown) {
  return [suggestionType, targetEntityType || "none", targetEntityId || "none", normalizeSuggestionValue(value)].join(":");
}
function isSensitiveSuggestion(suggestionType: string, payload: Record<string, unknown>, text = "") {
  const haystack = `${suggestionType} ${text} ${Object.values(payload).join(" ")}`.toLowerCase();
  return SENSITIVE_TERMS.some((t) => haystack.includes(t));
}

const SENSITIVITY_THRESHOLDS: Record<string, number> = { conservative: 0.85, balanced: 0.7, exploratory: 0.55 };
const AUTO_APPLY_THRESHOLDS: Record<string, Record<string, number>> = {
  add_profile_entry: { conservative: 0.78, balanced: 0.65, exploratory: 0.5 },
  add_relationship: { conservative: 0.80, balanced: 0.7, exploratory: 0.55 },
  add_moment: { conservative: 0.85, balanced: 0.75, exploratory: 0.6 },
  normalize_profile_entry: { conservative: 0.92, balanced: 0.85, exploratory: 0.75 },
};
function thresholdFor(suggestionType: string, sensitivity: string): number {
  const perType = AUTO_APPLY_THRESHOLDS[suggestionType];
  if (perType && perType[sensitivity] !== undefined) return perType[sensitivity];
  return SENSITIVITY_THRESHOLDS[sensitivity] ?? SENSITIVITY_THRESHOLDS.balanced;
}

async function filterSuppressedSuggestions(db: any, userId: string, suggestions: any[]) {
  if (suggestions.length === 0) return suggestions;
  const keys = suggestions.map((s) => s.suppression_key).filter(Boolean);
  if (keys.length === 0) return suggestions;
  const { data } = await db
    .from("ai_suggestion_suppressions")
    .select("suppression_key")
    .eq("user_id", userId)
    .in("suppression_key", keys);
  const blocked = new Set(((data || []) as any[]).map((r) => r.suppression_key));
  return suggestions.filter((s) => !s.suppression_key || !blocked.has(s.suppression_key));
}

async function getSuggestionPreferences(db: any, userId: string) {
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

function makePrepareSuggestion(db: any) {
  return async (suggestion: any, preferences: { mode: string; sensitivity: string; autoAddSensitive: boolean }) => {
    const threshold = thresholdFor(suggestion.suggestion_type, preferences.sensitivity);
    const confidence = suggestion.confidence_score ?? 0;
    // Normalization does not introduce new sensitive facts; it merges/relabels
    // facts the user already has. High-confidence cleanup should therefore run
    // silently even for health/relationship fields, instead of leaving janitor
    // work in Review Queue. Low-confidence conflict groups still require review.
    const isHighConfidenceNormalization = suggestion.suggestion_type === "normalize_profile_entry" && confidence >= 0.95;
    const canAutoApply = isHighConfidenceNormalization || (
      preferences.mode === "auto" &&
      confidence >= threshold &&
      (!suggestion.is_sensitive || preferences.autoAddSensitive)
    );
    if (!canAutoApply) return { ...suggestion, status: "pending_review" };

    if (suggestion.suggestion_type === "normalize_profile_entry") {
      try {
        const result = await applyNormalization(db, suggestion.payload as NormalizationPayload);
        if (result.ok && result.entryId) {
          return { ...suggestion, status: "auto_applied_unreviewed", target_entity_id: result.entryId, applied_at: new Date().toISOString() };
        }
      } catch (e) {
        console.error("[normalize-profile] auto-apply failed:", e);
      }
    }
    return { ...suggestion, status: "pending_review" };
  };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function getProfileInputHash(db: any, userId: string, contactId: string | null): Promise<string> {
  let query = db
    .from("profile_entries")
    .select("id, category_id, label, value, sort_order, linked_note_id, updated_at, created_at")
    .eq("user_id", userId)
    .order("id", { ascending: true });
  query = contactId ? query.eq("contact_id", contactId) : query.is("contact_id", null);
  const { data, error } = await query;
  if (error) throw error;
  return sha256Hex(JSON.stringify(data || []));
}

async function readRunState(db: any, userId: string, contactId: string | null) {
  const subjectType = contactId ? "contact" : "owner";
  const base = db
    .from("profile_normalization_runs")
    .select("id, input_hash, status, completed_at")
    .eq("user_id", userId)
    .eq("subject_type", subjectType)
    .limit(1);
  const { data, error } = contactId
    ? await base.eq("contact_id", contactId).maybeSingle()
    : await base.is("contact_id", null).maybeSingle();
  if (error) throw error;
  return data;
}

async function writeRunState(db: any, userId: string, contactId: string | null, values: Record<string, unknown>) {
  const subjectType = contactId ? "contact" : "owner";
  const existing = await readRunState(db, userId, contactId);
  const payload = {
    user_id: userId,
    contact_id: contactId,
    subject_type: subjectType,
    ...values,
  };
  if (existing?.id) {
    const { error } = await db.from("profile_normalization_runs").update(payload).eq("id", existing.id);
    if (error) throw error;
    return existing.id;
  }
  const { data, error } = await db.from("profile_normalization_runs").insert(payload).select("id").single();
  if (error) throw error;
  return data?.id;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;

    const db = createClient(SUPABASE_URL, SERVICE_ROLE);
    const anonClient = createClient(SUPABASE_URL, ANON);
    const { data: { user }, error: authErr } = await anonClient.auth.getUser(authHeader.replace("Bearer ", ""));
    if (authErr || !user) return json({ error: "Unauthorized" }, 401);
    const userId = user.id;

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "");

    const prepareSuggestionForInsert = makePrepareSuggestion(db);
    const helpers = { filterSuppressedSuggestions: (uid: string, s: any[]) => filterSuppressedSuggestions(db, uid, s), prepareSuggestionForInsert, isSensitiveSuggestion, buildSuppressionKey };

    if (action === "plan") {
      const scope = String(body?.scope || "owner");
      const contactId = scope === "owner" ? null : String(body?.contact_id || "");
      if (scope === "contact" && !contactId) return json({ error: "contact_id required" }, 400);
      // Authorize: caller must own the contact (RLS check).
      if (contactId) {
        const { data: c } = await db.from("contacts").select("id").eq("id", contactId).eq("user_id", userId).maybeSingle();
        if (!c) return json({ error: "contact not found" }, 404);
      }
      const includeNotesContext = body?.includeNotesContext === false ? false : true;
      const groups = await planSubjectNormalization({ supabase: db, userId, contactId, includeNotesContext });
      return json({ groups });
    }

    if (action === "backfill") {
      const scope = String(body?.scope || "owner");
      const preferences = await getSuggestionPreferences(db, userId);
      const force = body?.force === true;
      const includeNotesContext = body?.includeNotesContext === false ? false : true;

      const subjects: Array<string | null> = [];
      if (scope === "owner") {
        subjects.push(null);
      } else if (scope === "contact") {
        const contactId = String(body?.contact_id || "");
        if (!contactId) return json({ error: "contact_id required" }, 400);
        const { data: c } = await db.from("contacts").select("id").eq("id", contactId).eq("user_id", userId).maybeSingle();
        if (!c) return json({ error: "contact not found" }, 404);
        subjects.push(contactId);
      } else if (scope === "all_contacts") {
        subjects.push(null);
        const { data: contacts } = await db
          .from("contacts")
          .select("id")
          .eq("user_id", userId)
          .is("merged_into", null)
          .limit(500);
        for (const c of (contacts || []) as any[]) subjects.push(c.id);
      } else {
        return json({ error: "invalid scope" }, 400);
      }

      const runOne = async (subj: string | null): Promise<SubjectRunResult> => {
        const subjectLabel = subj ?? "owner";
        const inputHash = await getProfileInputHash(db, userId, subj);
        const state = await readRunState(db, userId, subj);
        if (!force && state?.status === "completed" && state.input_hash === inputHash) {
          return {
            subject: subjectLabel,
            input_hash: inputHash,
            completed_hash: inputHash,
            status: "skipped",
            created: 0,
            autoApplied: 0,
            planned: 0,
            applied: 0,
            review: 0,
            skipped: 1,
          };
        }

        await writeRunState(db, userId, subj, {
          input_hash: inputHash,
          status: "running",
          planned_count: 0,
          applied_count: 0,
          review_count: 0,
          skipped_count: 0,
          error_message: null,
          started_at: new Date().toISOString(),
          completed_at: null,
        });

        try {
          const aggregate = { created: 0, autoApplied: 0, planned: 0, applied: 0, review: 0, skipped: 0 };
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
            aggregate.created += r.created;
            aggregate.autoApplied += r.autoApplied;
            aggregate.planned += r.planned;
            aggregate.applied += r.applied;
            aggregate.review += r.review;
            aggregate.skipped += r.skipped;
            // Direct deterministic passes mutate rows. Re-plan immediately so
            // groups that were intentionally non-overlapping in pass N can be
            // folded in pass N+1 before we record this input as complete.
            if (r.applied === 0 || r.planned === 0) break;
          }
          const completedHash = await getProfileInputHash(db, userId, subj);
          await writeRunState(db, userId, subj, {
            input_hash: completedHash,
            status: "completed",
            planned_count: aggregate.planned,
            applied_count: aggregate.applied,
            review_count: aggregate.review,
            skipped_count: aggregate.skipped,
            error_message: null,
            completed_at: new Date().toISOString(),
          });
          return { subject: subjectLabel, input_hash: inputHash, completed_hash: completedHash, status: "completed", ...aggregate };
        } catch (e) {
          const message = String(e);
          await writeRunState(db, userId, subj, {
            input_hash: inputHash,
            status: "failed",
            error_message: message,
            completed_at: new Date().toISOString(),
          });
          console.error(`[normalize-profile] backfill subject=${subj}`, e);
          return {
            subject: subjectLabel,
            input_hash: inputHash,
            status: "failed",
            created: 0,
            autoApplied: 0,
            planned: 0,
            applied: 0,
            review: 0,
            skipped: 0,
            error: message,
          };
        }
      };

      const runAll = async () => {
        const perSubject: SubjectRunResult[] = [];
        for (const subj of subjects) perSubject.push(await runOne(subj));
        const totals = perSubject.reduce(
          (acc, r) => ({
            created: acc.created + r.created,
            autoApplied: acc.autoApplied + r.autoApplied,
            planned: acc.planned + r.planned,
            applied: acc.applied + r.applied,
            review: acc.review + r.review,
            skipped: acc.skipped + r.skipped,
          }),
          { created: 0, autoApplied: 0, planned: 0, applied: 0, review: 0, skipped: 0 },
        );
        console.log(`[normalize-profile] backfill done: ${JSON.stringify({ scope, subjectCount: subjects.length, ...totals })}`);
        return { perSubject, totals };
      };

      if (scope === "contact" || scope === "owner") {
        const result = await runAll();
        return json({ ok: true, completed: true, scope, subjectCount: subjects.length, ...result }, 200);
      }

      try {
        // @ts-expect-error - EdgeRuntime is a Supabase Edge global
        EdgeRuntime.waitUntil(runAll());
      } catch {
        runAll();
      }
      return json({ ok: true, started: true, scope, subjectCount: subjects.length }, 202);
    }

    if (action === "apply") {
      const reviewId = String(body?.review_id || "");
      if (!reviewId) return json({ error: "review_id required" }, 400);
      const { data: row, error } = await db
        .from("review_queue")
        .select("id, user_id, suggestion_type, payload, status")
        .eq("id", reviewId)
        .maybeSingle();
      if (error || !row) return json({ error: "not found" }, 404);
      if (row.user_id !== userId) return json({ error: "forbidden" }, 403);
      if (row.suggestion_type !== "normalize_profile_entry") return json({ error: "wrong suggestion_type" }, 400);

      const result = await applyNormalization(db, row.payload as NormalizationPayload);
      if (!result.ok) {
        // The suggestion can no longer be applied (source entries were edited
        // or deleted, or the target category vanished). Resolve the queue row
        // so it stops re-appearing in the user's Review Queue forever.
        if (["stale", "empty", "category_unresolved"].includes(result.reason || "")) {
          await db
            .from("review_queue")
            .update({ status: "removed", reviewed_at: new Date().toISOString() })
            .eq("id", reviewId);
        }
        return json({ ok: false, reason: result.reason }, 409);
      }

      await db
        .from("review_queue")
        .update({ status: "kept", target_entity_id: result.entryId, applied_at: new Date().toISOString() })
        .eq("id", reviewId);

      return json({ ok: true, entry_id: result.entryId });
    }

    if (action === "rollback") {
      const reviewId = String(body?.review_id || "");
      if (!reviewId) return json({ error: "review_id required" }, 400);
      const { data: row, error } = await db
        .from("review_queue")
        .select("id, user_id, suggestion_type, payload, target_entity_id, status")
        .eq("id", reviewId)
        .maybeSingle();
      if (error || !row) return json({ error: "not found" }, 404);
      if (row.user_id !== userId) return json({ error: "forbidden" }, 403);
      if (row.suggestion_type !== "normalize_profile_entry") return json({ error: "wrong suggestion_type" }, 400);

      await rollbackNormalization(db, row.payload as NormalizationPayload, row.target_entity_id);
      await db
        .from("review_queue")
        .update({ status: "removed" })
        .eq("id", reviewId);
      return json({ ok: true });
    }

    return json({ error: "unknown action" }, 400);
  } catch (err) {
    console.error("[normalize-profile] handler error:", err);
    return json({ error: String(err) }, 500);
  }
});
