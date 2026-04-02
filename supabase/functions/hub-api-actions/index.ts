import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authenticateHubKey, requireScope } from "../_shared/hub-auth.ts";
import { checkRateLimit } from "../_shared/hub-rate-limit.ts";
import {
  json,
  errorJson,
  handleOptions,
  parsePath,
  paginationParams,
} from "../_shared/hub-helpers.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return handleOptions();

  const { result: auth, error: authErr } = await authenticateHubKey(req);
  if (authErr) return authErr;
  const scopeErr = requireScope(auth!.scopes, "actions");
  if (scopeErr) return scopeErr;

  const rl = await checkRateLimit(auth!.keyId);
  if (!rl.allowed) return rl.error!;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const userId = auth!.userId;
  const url = new URL(req.url);
  const parts = parsePath(url);
  const action = parts[1] || "";

  try {
    // GET /hub-api-actions/sync-status
    if (req.method === "GET" && action === "sync-status") {
      const { data } = await supabase
        .from("action_items")
        .select("updated_at")
        .eq("user_id", userId)
        .order("updated_at", { ascending: false })
        .limit(1);

      const { count: totalCount } = await supabase
        .from("action_items")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId);

      const { count: openCount } = await supabase
        .from("action_items")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("status", "open");

      return json({
        data: {
          last_modified: data?.[0]?.updated_at || null,
          total_count: totalCount || 0,
          open_count: openCount || 0,
        },
      });
    }

    // GET /hub-api-actions — List
    if (req.method === "GET" && !action) {
      const { limit, offset } = paginationParams(url);
      const status = url.searchParams.get("status");
      const priority = url.searchParams.get("priority");
      const contactId = url.searchParams.get("contact_id");

      let query = supabase
        .from("action_items")
        .select("id, content, status, priority, due_date, tags, contact_id, source_note_id, completed_at, created_at, updated_at", { count: "exact" })
        .eq("user_id", userId);

      if (status) query = query.eq("status", status);
      if (priority) query = query.eq("priority", priority);
      if (contactId) query = query.eq("contact_id", contactId);

      query = query.order("updated_at", { ascending: false }).range(offset, offset + limit - 1);

      const { data, error, count } = await query;
      if (error) return errorJson("INTERNAL", error.message, 500);
      return json({ data, meta: { total: count || 0, offset, limit } });
    }

    // GET /hub-api-actions/{id}
    if (req.method === "GET" && action) {
      const { data, error } = await supabase
        .from("action_items")
        .select("*")
        .eq("id", action)
        .eq("user_id", userId)
        .single();

      if (error || !data) return errorJson("NOT_FOUND", "Action item not found", 404);
      return json({ data });
    }

    // PUT /hub-api-actions/{id} — Update
    if (req.method === "PUT" && action) {
      const body = await req.json();
      const updates: Record<string, unknown> = {};

      for (const field of ["content", "status", "priority", "due_date", "tags", "contact_id"]) {
        if (body[field] !== undefined) updates[field] = body[field];
      }

      // Handle completion
      if (body.status === "completed" && !body.completed_at) {
        updates.completed_at = new Date().toISOString();
      }
      if (body.completed_at !== undefined) updates.completed_at = body.completed_at;

      if (Object.keys(updates).length === 0) {
        return errorJson("BAD_REQUEST", "No valid fields to update", 400);
      }

      const { data, error } = await supabase
        .from("action_items")
        .update(updates)
        .eq("id", action)
        .eq("user_id", userId)
        .select("id, content, status, priority, updated_at")
        .single();

      if (error) return errorJson("NOT_FOUND", "Action item not found", 404);
      return json({ data });
    }

    return errorJson("NOT_FOUND", "Endpoint not found", 404);
  } catch (err) {
    return errorJson("INTERNAL", (err as Error).message, 500);
  }
});
