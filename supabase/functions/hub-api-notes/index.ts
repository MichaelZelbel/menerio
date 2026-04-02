import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authenticateHubKey, requireScope } from "../_shared/hub-auth.ts";
import { checkRateLimit } from "../_shared/hub-rate-limit.ts";
import {
  corsHeaders,
  json,
  errorJson,
  handleOptions,
  parsePath,
  paginationParams,
} from "../_shared/hub-helpers.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return handleOptions();

  // Auth
  const { result: auth, error: authErr } = await authenticateHubKey(req);
  if (authErr) return authErr;
  const scopeErr = requireScope(auth!.scopes, "notes");
  if (scopeErr) return scopeErr;

  // Rate limit
  const rl = await checkRateLimit(auth!.keyId);
  if (!rl.allowed) return rl.error!;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const userId = auth!.userId;
  const url = new URL(req.url);
  const parts = parsePath(url);
  // parts[0] = "hub-api-notes", parts[1] = action/id, parts[2] = sub-action
  const action = parts[1] || "";

  try {
    // GET /hub-api-notes/search?q=...
    if (req.method === "GET" && action === "search") {
      const q = url.searchParams.get("q") || "";
      if (!q) return errorJson("BAD_REQUEST", "q parameter required", 400);

      const { limit } = paginationParams(url);

      // Call the existing semantic search function internally
      const searchUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/search-notes-semantic`;
      const searchRes = await fetch(searchUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query: q, limit }),
      });

      // The search function needs a user token, so we do a direct DB search instead
      const query = q.toLowerCase();
      const { data, error } = await supabase
        .from("notes")
        .select("id, title, content, tags, entity_type, is_favorite, is_pinned, created_at, updated_at")
        .eq("user_id", userId)
        .eq("is_trashed", false)
        .or(`title.ilike.%${query}%,content.ilike.%${query}%`)
        .order("updated_at", { ascending: false })
        .limit(limit);

      if (error) return errorJson("INTERNAL", error.message, 500);
      return json({ data, meta: { total: data?.length || 0, query: q } });
    }

    // GET /hub-api-notes/sync-status
    if (req.method === "GET" && action === "sync-status") {
      const { data, error } = await supabase
        .from("notes")
        .select("updated_at")
        .eq("user_id", userId)
        .eq("is_trashed", false)
        .order("updated_at", { ascending: false })
        .limit(1);

      const { count } = await supabase
        .from("notes")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("is_trashed", false);

      return json({
        data: {
          last_modified: data?.[0]?.updated_at || null,
          note_count: count || 0,
        },
      });
    }

    // GET /hub-api-notes/{id}
    if (req.method === "GET" && action && action !== "search" && action !== "sync-status") {
      const { data, error } = await supabase
        .from("notes")
        .select("id, title, content, tags, entity_type, metadata, structured_fields, related, is_favorite, is_pinned, is_external, source_app, source_id, source_url, sync_status, created_at, updated_at")
        .eq("id", action)
        .eq("user_id", userId)
        .eq("is_trashed", false)
        .single();

      if (error || !data) return errorJson("NOT_FOUND", "Note not found", 404);
      return json({ data }, 200, {
        "X-Menerio-Modified": data.updated_at || "",
      });
    }

    // GET /hub-api-notes — List
    if (req.method === "GET" && !action) {
      const { limit, offset } = paginationParams(url);
      const sort = url.searchParams.get("sort") || "updated_at";
      const order = url.searchParams.get("order") || "desc";
      const entityType = url.searchParams.get("type");
      const tag = url.searchParams.get("tag");

      let query = supabase
        .from("notes")
        .select("id, title, content, tags, entity_type, is_favorite, is_pinned, source_app, created_at, updated_at", { count: "exact" })
        .eq("user_id", userId)
        .eq("is_trashed", false);

      if (entityType) query = query.eq("entity_type", entityType);
      if (tag) query = query.contains("tags", [tag]);

      const allowedSorts = ["updated_at", "created_at", "title"];
      const sortCol = allowedSorts.includes(sort) ? sort : "updated_at";
      query = query.order(sortCol, { ascending: order === "asc" }).range(offset, offset + limit - 1);

      const { data, error, count } = await query;
      if (error) return errorJson("INTERNAL", error.message, 500);
      return json({ data, meta: { total: count || 0, offset, limit } });
    }

    // POST /hub-api-notes — Create
    if (req.method === "POST" && !action) {
      const body = await req.json();
      if (!body.title || typeof body.title !== "string") {
        return errorJson("BAD_REQUEST", "title is required", 400);
      }

      const noteData: Record<string, unknown> = {
        user_id: userId,
        title: body.title,
        content: body.content || "",
        tags: Array.isArray(body.tags) ? body.tags : [],
        entity_type: body.entity_type || null,
        metadata: body.metadata || {},
        structured_fields: body.structured_fields || {},
        related: body.related || [],
        source_app: body.source_app || "hub-api",
        source_id: body.source_id || null,
        source_url: body.source_url || null,
      };

      const { data, error } = await supabase
        .from("notes")
        .insert(noteData)
        .select("id, title, created_at, updated_at")
        .single();

      if (error) return errorJson("INTERNAL", error.message, 500);

      // Trigger background processing (embedding, metadata)
      fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/process-note`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ noteId: data.id, userId }),
      }).catch(() => {});

      return json({ data }, 201);
    }

    // PUT /hub-api-notes/{id} — Update
    if (req.method === "PUT" && action) {
      const body = await req.json();
      const updates: Record<string, unknown> = {};

      if (body.title !== undefined) updates.title = body.title;
      if (body.content !== undefined) updates.content = body.content;
      if (body.tags !== undefined) updates.tags = body.tags;
      if (body.entity_type !== undefined) updates.entity_type = body.entity_type;
      if (body.metadata !== undefined) updates.metadata = body.metadata;
      if (body.structured_fields !== undefined) updates.structured_fields = body.structured_fields;
      if (body.is_favorite !== undefined) updates.is_favorite = body.is_favorite;
      if (body.is_pinned !== undefined) updates.is_pinned = body.is_pinned;

      if (Object.keys(updates).length === 0) {
        return errorJson("BAD_REQUEST", "No valid fields to update", 400);
      }

      const { data, error } = await supabase
        .from("notes")
        .update(updates)
        .eq("id", action)
        .eq("user_id", userId)
        .select("id, title, updated_at")
        .single();

      if (error) return errorJson("NOT_FOUND", "Note not found", 404);

      // Re-process in background
      fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/process-note`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ noteId: data.id, userId }),
      }).catch(() => {});

      return json({ data });
    }

    // DELETE /hub-api-notes/{id} — Soft delete
    if (req.method === "DELETE" && action) {
      const { error } = await supabase
        .from("notes")
        .update({ is_trashed: true, trashed_at: new Date().toISOString() })
        .eq("id", action)
        .eq("user_id", userId);

      if (error) return errorJson("INTERNAL", error.message, 500);
      return json({ data: { success: true } });
    }

    return errorJson("NOT_FOUND", "Endpoint not found", 404);
  } catch (err) {
    return errorJson("INTERNAL", (err as Error).message, 500);
  }
});
