// Whole-profile duplicate audit gate.
//
// A profile is only "clean" once the auditor has looked at ALL of its entries
// at once and reported zero duplicates. Any write to profile_entries marks the
// scope dirty (DB trigger); this function drains dirty scopes.
//
// Actions:
//   run      { scope: "owner"|"contact", contact_id? }  -> audit one profile now
//   sweep    { limit? }                                  -> audit dirty scopes (background)
//   backfill {}                                          -> mark everything dirty + sweep (background)
//   status   { scope, contact_id? }                      -> current audit state
//   rollback { merge_id }                                -> undo one applied merge

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { z } from "npm:zod@3.23.8";
import { runChat } from "../_shared/llm-router.ts";
import { CALL_SITE_DEFAULTS } from "../_shared/llm-defaults.ts";
import {
  buildAuditUserMessage,
  parseAuditResponse,
  planExactDuplicates,
  planMerges,
  PROFILE_AUDIT_SYSTEM_PROMPT,
  type AuditEntry,
  type MergePlanItem,
} from "../_shared/profile-audit.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const MAX_ROUNDS = 3;
const CALL_SITE = "profile-audit.main";

function auditDefaults() {
  const row = CALL_SITE_DEFAULTS.find((c) => c.call_site === CALL_SITE);
  return {
    provider: (row?.provider ?? "openrouter") as any,
    model: row?.model ?? "google/gemini-2.5-flash",
    systemPrompt: row?.system_prompt ?? PROFILE_AUDIT_SYSTEM_PROMPT,
    temperature: row?.temperature ?? 0,
  };
}

async function loadEntries(db: any, userId: string, contactId: string | null): Promise<AuditEntry[]> {
  let q = db
    .from("profile_entries")
    .select("id, label, value, is_pinned, created_at, origin, category_id, profile_categories(slug)")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  q = contactId ? q.eq("contact_id", contactId) : q.is("contact_id", null);
  const { data, error } = await q;
  if (error) throw new Error(`load entries failed: ${error.message}`);
  return (data || []).map((r: any) => ({
    id: r.id,
    label: r.label,
    value: r.value,
    is_pinned: !!r.is_pinned,
    created_at: r.created_at,
    origin: r.origin,
    category_slug: r.profile_categories?.slug || "other",
  }));
}

async function personName(db: any, userId: string, contactId: string | null): Promise<string> {
  if (contactId) {
    const { data } = await db.from("contacts").select("name").eq("id", contactId).maybeSingle();
    return data?.name || "this contact";
  }
  const { data } = await db.from("profiles").select("display_name").eq("id", userId).maybeSingle();
  return data?.display_name || "the profile owner";
}

async function applyPlan(
  db: any,
  runId: string | null,
  plan: MergePlanItem[],
): Promise<{ applied: number; removed: number }> {
  let applied = 0;
  let removed = 0;
  for (const item of plan) {
    const { data, error } = await db.rpc("profile_audit_apply_merge", {
      _run_id: runId,
      _keep_id: item.keepId,
      _remove_ids: item.removeIds,
      _label: item.label,
      _value: item.value,
      _reason: item.reason,
    });
    if (error) {
      console.error("[profile-audit] merge failed", item.keepId, error.message);
      continue;
    }
    if (data?.applied) {
      applied += 1;
      removed += Number(data.removed || 0);
    }
  }
  return { applied, removed };
}

async function upsertRun(
  db: any,
  userId: string,
  contactId: string | null,
  patch: Record<string, unknown>,
): Promise<string | null> {
  let sel = db.from("profile_audit_runs").select("id").eq("user_id", userId);
  sel = contactId ? sel.eq("contact_id", contactId) : sel.is("contact_id", null);
  const { data: existing } = await sel.maybeSingle();


  if (existing?.id) {
    await db.from("profile_audit_runs").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", existing.id);
    return existing.id;
  }
  const { data: inserted } = await db
    .from("profile_audit_runs")
    .insert({ user_id: userId, contact_id: contactId, ...patch })
    .select("id")
    .maybeSingle();
  return inserted?.id ?? null;
}

/** Audit one profile until the LLM reports zero duplicates (or rounds run out). */
async function auditScope(
  db: any,
  userId: string,
  contactId: string | null,
): Promise<Record<string, unknown>> {
  const runId = await upsertRun(db, userId, contactId, {
    status: "running",
    started_at: new Date().toISOString(),
    last_error: null,
  });

  try {
    const name = await personName(db, userId, contactId);
    let rounds = 0;
    let totalApplied = 0;
    let totalRemoved = 0;
    let findings: unknown[] = [];
    let clean = false;

    while (rounds < MAX_ROUNDS) {
      rounds += 1;
      const entries = await loadEntries(db, userId, contactId);

      if (entries.length < 2) {
        clean = true;
        break;
      }

      // Deterministic pre-pass — never depends on a model call.
      const exact = planExactDuplicates(entries);
      if (exact.length > 0) {
        const res = await applyPlan(db, runId, exact);
        totalApplied += res.applied;
        totalRemoved += res.removed;
        continue;
      }

      const chat = await runChat({
        db,
        userId,
        callSite: CALL_SITE,
        defaults: auditDefaults(),
        messages: [{ role: "user", content: buildAuditUserMessage(name, entries) }],
        callOptions: { response_format: { type: "json_object" } },
      });

      const parsed = parseAuditResponse(chat.content || "");
      const groups = parsed.groups || [];
      if (groups.length === 0) {
        clean = true;
        break;
      }

      const { merges, rejected } = planMerges(entries, groups);
      findings = [...findings, ...rejected];

      if (merges.length === 0) {
        // The model keeps proposing merges the guards refuse: stop and flag.
        return await finish(db, runId, userId, contactId, {
          status: rejected.length > 0 ? "conflict" : "clean",
          rounds,
          merged_count: totalApplied,
          findings,
        }, { applied: totalApplied, removed: totalRemoved });
      }

      const res = await applyPlan(db, runId, merges);
      totalApplied += res.applied;
      totalRemoved += res.removed;
      if (res.applied === 0) break;
    }

    return await finish(db, runId, userId, contactId, {
      status: clean ? "clean" : "conflict",
      rounds,
      merged_count: totalApplied,
      findings,
    }, { applied: totalApplied, removed: totalRemoved });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[profile-audit] scope failed", userId, contactId, message);
    await upsertRun(db, userId, contactId, { status: "dirty", last_error: message });
    return { ok: false, error: message };
  }
}

async function finish(
  db: any,
  runId: string | null,
  userId: string,
  contactId: string | null,
  patch: Record<string, unknown>,
  stats: { applied: number; removed: number },
) {
  let cq = db
    .from("profile_entries")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);
  cq = contactId ? cq.eq("contact_id", contactId) : cq.is("contact_id", null);
  const { count } = await cq;


  await upsertRun(db, userId, contactId, {
    ...patch,
    entry_count: count ?? 0,
    completed_at: new Date().toISOString(),
  });
  return { ok: true, run_id: runId, ...patch, ...stats };
}

async function sweepDirty(db: any, limit: number) {
  const { data } = await db
    .from("profile_audit_runs")
    .select("user_id, contact_id")
    .eq("status", "dirty")
    .order("dirty_at", { ascending: true })
    .limit(limit);
  let done = 0;
  for (const row of data || []) {
    await auditScope(db, row.user_id, row.contact_id);
    done += 1;
  }
  return done;
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

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "run");

    const bearer = authHeader.replace(/^Bearer\s+/i, "").trim();
    const isServiceCall = !!SERVICE_ROLE && bearer === SERVICE_ROLE;

    let userId: string;
    if (isServiceCall) {
      const claimed = String(body?.user_id || "");
      if (!z.string().uuid().safeParse(claimed).success) {
        // sweep is the only action allowed without a user scope
        if (action !== "sweep") return json({ error: "user_id required for service-role calls" }, 400);
        userId = "";
      } else {
        userId = claimed;
      }
    } else {
      const anonClient = createClient(SUPABASE_URL, ANON);
      const { data: { user }, error: authErr } = await anonClient.auth.getUser(bearer);
      if (authErr || !user) return json({ error: "Unauthorized" }, 401);
      userId = user.id;
    }

    const scopeContactId = async (): Promise<string | null> => {
      const scope = String(body?.scope || "owner");
      if (scope === "owner") return null;
      const contactId = String(body?.contact_id || "");
      if (!z.string().uuid().safeParse(contactId).success) throw new Error("contact_id required");
      const { data } = await db
        .from("contacts").select("id").eq("id", contactId).eq("user_id", userId).maybeSingle();
      if (!data) throw new Error("contact not found");
      return contactId;
    };

    if (action === "status") {
      const contactId = await scopeContactId();
      let q = db.from("profile_audit_runs")
        .select("status, rounds, merged_count, findings, dirty_at, completed_at, last_error")
        .eq("user_id", userId);
      q = contactId ? q.eq("contact_id", contactId) : q.is("contact_id", null);
      const { data } = await q.maybeSingle();
      return json({ status: data?.status || "clean", run: data ?? null });
    }

    if (action === "run") {
      const contactId = await scopeContactId();
      const result = await auditScope(db, userId, contactId);
      return json(result);
    }

    if (action === "run_async") {
      const contactId = await scopeContactId();
      // @ts-ignore Deno runtime global
      EdgeRuntime.waitUntil(auditScope(db, userId, contactId));
      return json({ accepted: true }, 202);
    }

    if (action === "sweep") {
      const limit = Math.min(Number(body?.limit ?? 25), 200);
      // @ts-ignore Deno runtime global
      EdgeRuntime.waitUntil(sweepDirty(db, limit));
      return json({ accepted: true, limit }, 202);
    }

    if (action === "backfill") {
      if (!userId) return json({ error: "user_id required" }, 400);
      const task = (async () => {
        const { data: contacts } = await db
          .from("contacts").select("id").eq("user_id", userId);
        await db.rpc("profile_audit_mark_dirty", { _user_id: userId, _contact_id: null });
        for (const c of contacts || []) {
          await db.rpc("profile_audit_mark_dirty", { _user_id: userId, _contact_id: c.id });
        }
        // Drain in batches so one invocation covers a whole vault.
        for (let i = 0; i < 20; i++) {
          const done = await sweepDirty(db, 25);
          if (done === 0) break;
        }
      })();
      // @ts-ignore Deno runtime global
      EdgeRuntime.waitUntil(task);
      return json({ accepted: true }, 202);
    }

    if (action === "rollback") {
      const mergeId = String(body?.merge_id || "");
      if (!z.string().uuid().safeParse(mergeId).success) return json({ error: "merge_id required" }, 400);
      const { data: merge } = await db
        .from("profile_audit_merges").select("id, user_id").eq("id", mergeId).maybeSingle();
      if (!merge || merge.user_id !== userId) return json({ error: "not found" }, 404);
      const { data, error } = await db.rpc("profile_audit_rollback_merge", { _merge_id: mergeId });
      if (error) return json({ error: error.message }, 400);
      return json(data);
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return json({ error: message }, 400);
  }
});
