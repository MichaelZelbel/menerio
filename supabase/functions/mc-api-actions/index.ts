import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authenticateGodspeedKey, requireScope } from "../_shared/mc-auth.ts";
import { checkRateLimit } from "../_shared/mc-rate-limit.ts";
import {
  json,
  errorJson,
  handleOptions,
  parsePath,
  paginationParams,
  isUuid,
  readJsonObject,
  pickTypedFields,
  dbErrorResponse,
} from "../_shared/mc-helpers.ts";

const ACTION_STATUSES = ["open", "in_progress", "done", "dismissed"];
const ACTION_PRIORITIES = ["low", "normal", "high", "urgent"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return handleOptions();

  const { result: auth, error: authErr } = await authenticateGodspeedKey(req);
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
    // GET /mc-api-actions/sync-status
    if (req.method === "GET" && action === "sync-status") {
      const { data, error } = await supabase
        .from("action_items")
        .select("updated_at")
        .eq("user_id", userId)
        .order("updated_at", { ascending: false })
        .limit(1);

      const { count: totalCount, error: totalError } = await supabase
        .from("action_items")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId);

      const { count: openCount, error: openError } = await supabase
        .from("action_items")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("status", "open");

      // A failed read used to answer 200 with every count 0.
      const readError = error ?? totalError ?? openError;
      if (readError) return dbErrorResponse(readError);

      return json({
        data: {
          last_modified: data?.[0]?.updated_at || null,
          total_count: totalCount || 0,
          open_count: openCount || 0,
        },
      });
    }

    // GET /mc-api-actions — List
    if (req.method === "GET" && !action) {
      const { limit, offset } = paginationParams(url);
      // "completed" is the old word for "done" (see PUT); filtering on it
      // matched nothing. A contact_id that is not a UUID was a 500.
      const rawStatus = url.searchParams.get("status");
      const status = rawStatus === "completed" ? "done" : rawStatus;
      const priority = url.searchParams.get("priority");
      const contactId = url.searchParams.get("contact_id");
      if (status && !ACTION_STATUSES.includes(status)) {
        return errorJson("BAD_REQUEST", `status must be one of: ${ACTION_STATUSES.join(", ")}`, 400);
      }
      if (contactId && !isUuid(contactId)) return errorJson("BAD_REQUEST", "contact_id must be a UUID", 400);

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

    // GET /mc-api-actions/{id}
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

    // PUT /mc-api-actions/{id} — Update
    if (req.method === "PUT" && action) {
      if (!isUuid(action)) return errorJson("NOT_FOUND", "Action item not found", 404);
      const { body, error: bodyErr } = await readJsonObject(req);
      if (bodyErr) return bodyErr;

      const { updates, error: fieldErr } = pickTypedFields(body, {
        content: "string",
        status: "string",
        priority: "string",
        due_date: "nullable-date",
        tags: "string-array",
        contact_id: "nullable-uuid",
        completed_at: "nullable-timestamp",
      });
      if (fieldErr) return fieldErr;

      // "completed" is what this endpoint used to test for, but the app and
      // the MCP tools only know "done": an item set to "completed" vanished
      // from every column of the Actions board, and one set to "done" through
      // here never got its completed_at. Accept the old word, store the real one.
      if (updates.status === "completed") updates.status = "done";
      if (updates.status !== undefined && !ACTION_STATUSES.includes(updates.status as string)) {
        return errorJson("BAD_REQUEST", `status must be one of: ${ACTION_STATUSES.join(", ")}`, 400);
      }
      if (updates.priority !== undefined && !ACTION_PRIORITIES.includes(updates.priority as string)) {
        return errorJson("BAD_REQUEST", `priority must be one of: ${ACTION_PRIORITIES.join(", ")}`, 400);
      }

      // Same rule as the Actions board: done stamps completed_at, any other
      // status clears it, and an explicit completed_at in the body wins.
      if (updates.status !== undefined && body.completed_at === undefined) {
        updates.completed_at = updates.status === "done" ? new Date().toISOString() : null;
      }

      if (Object.keys(updates).length === 0) {
        return errorJson("BAD_REQUEST", "No valid fields to update", 400);
      }

      // A contact id is stored as given with the service key, so check it is
      // one of this user's people rather than linking the item to a stranger's.
      if (typeof updates.contact_id === "string") {
        const { data: contact, error: contactErr } = await supabase
          .from("contacts")
          .select("id")
          .eq("id", updates.contact_id)
          .eq("user_id", userId)
          .maybeSingle();
        if (contactErr) return dbErrorResponse(contactErr);
        if (!contact) return errorJson("BAD_REQUEST", "contact_id does not match any of your contacts", 400);
      }

      const { data, error } = await supabase
        .from("action_items")
        .update(updates)
        .eq("id", action)
        .eq("user_id", userId)
        .select("id, content, status, priority, updated_at")
        .maybeSingle();

      if (error) return dbErrorResponse(error);
      if (!data) return errorJson("NOT_FOUND", "Action item not found", 404);
      return json({ data });
    }

    return errorJson("NOT_FOUND", "Endpoint not found", 404);
  } catch (err) {
    return errorJson("INTERNAL", (err as Error).message, 500);
  }
});
