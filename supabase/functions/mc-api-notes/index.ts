import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authenticateGodspeedKey, requireScope } from "../_shared/mc-auth.ts";
import { checkRateLimit } from "../_shared/mc-rate-limit.ts";
import { getEmbeddingWithCredits } from "../_shared/llm-credits.ts";
import { combinedNoteSearch } from "../_shared/note-search.ts";
import { loadMcVisibility, noteIsVisible, notHidden } from "../_shared/mc-visibility.ts";
import {
  corsHeaders,
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

/**
 * A folder path the note tree can actually render.
 *
 * The tree builds its folders by splitting this string on "/", so a leading
 * slash would put every note inside a nameless folder above the real one. Kept
 * character for character the same as normalizePath in
 * src/components/notes/NoteTree.tsx, which is what the UI applies when it reads
 * the column back, so a path cannot mean one thing on write and another on read.
 *
 * An empty string is the root, which is what the column defaults to.
 */
function normalizeFolderPath(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/^\/+|\/+$/g, "").replace(/\/+/g, "/").trim();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return handleOptions();

  // Auth
  const { result: auth, error: authErr } = await authenticateGodspeedKey(req);
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
  // parts[0] = "mc-api-notes", parts[1] = action/id, parts[2] = sub-action
  const action = parts[1] || "";

  try {
    // GET /mc-api-notes/search?q=...
    if (req.method === "GET" && action === "search") {
      const q = url.searchParams.get("q") || "";
      if (!q) return errorJson("BAD_REQUEST", "q parameter required", 400);
      const visibility = await loadMcVisibility(supabase, userId);

      // Search by meaning and by text, in this process. The app's semantic
      // search function needs a user token, and a call to it with the service
      // key used to sit here anyway: awaited, answered 401, and its result never
      // read, so every mission control search paid an extra function invocation and failed
      // outright when that call did. No second function is involved now: the
      // embedding is fetched through the same credit-aware helper the MCP
      // server uses, charged to the user the key belongs to, and the query runs
      // against match_note_chunks directly. Out of credits or a provider outage
      // means text only (mode says which), never an error.
      const { results, mode } = await combinedNoteSearch(supabase, {
        userId,
        query: q,
        limit: url.searchParams.get("limit"),
        sourceApp: url.searchParams.get("source_app"),
        visible: (row) => noteIsVisible(row, visibility),
        embed: async (text) =>
          (await getEmbeddingWithCredits(
            supabase, Deno.env.get("OPENROUTER_API_KEY")!, userId, "mc-api-search", text,
          )).embedding,
      });

      return json({ data: results, mode, meta: { total: results.length, query: q, mode } });
    }

    // GET /mc-api-notes/sync-status
    if (req.method === "GET" && action === "sync-status") {
      const { data, error } = await supabase
        .from("notes")
        .select("updated_at")
        .eq("user_id", userId)
        .eq("is_trashed", false)
        .order("updated_at", { ascending: false })
        .limit(1);

      const { count, error: countError } = await supabase
        .from("notes")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("is_trashed", false);

      // Both errors used to be ignored, and a failed read answered 200 with
      // note_count 0 and last_modified null: to a syncing client, "your
      // account is empty and nothing ever changed".
      if (error || countError) return dbErrorResponse((error ?? countError)!);

      return json({
        data: {
          last_modified: data?.[0]?.updated_at || null,
          note_count: count || 0,
        },
      });
    }

    // GET /mc-api-notes/{id}
    if (req.method === "GET" && action && action !== "search" && action !== "sync-status") {
      const { data, error } = await supabase
        .from("notes")
        .select("id, title, content, tags, entity_type, metadata, structured_fields, related, is_favorite, is_pinned, is_external, source_app, source_id, source_url, folder_path, sync_status, created_at, updated_at, ai_visibility")
        .eq("id", action)
        .eq("user_id", userId)
        .eq("is_trashed", false)
        .single();

      if (error || !data) return errorJson("NOT_FOUND", "Note not found", 404);
      // A note hidden from AI, or about a person marked sensitive, is not
      // this key's to read; same answer as a note that does not exist.
      if (!noteIsVisible(data, await loadMcVisibility(supabase, userId))) {
        return errorJson("NOT_FOUND", "Note not found", 404);
      }
      return json({ data }, 200, {
        "X-Menerio-Modified": data.updated_at || "",
      });
    }

    // GET /mc-api-notes — List
    if (req.method === "GET" && !action) {
      const { limit, offset } = paginationParams(url);
      const sort = url.searchParams.get("sort") || "updated_at";
      const order = url.searchParams.get("order") || "desc";
      const entityType = url.searchParams.get("type");
      const tag = url.searchParams.get("tag");

      const visibility = await loadMcVisibility(supabase, userId);
      let query = notHidden(supabase
        .from("notes")
        .select("id, title, content, tags, entity_type, is_favorite, is_pinned, source_app, folder_path, created_at, updated_at, matched_people:metadata->matched_people", { count: "exact" })
        .eq("user_id", userId)
        .eq("is_trashed", false));

      if (entityType) query = query.eq("entity_type", entityType);
      if (tag) query = query.contains("tags", [tag]);

      const allowedSorts = ["updated_at", "created_at", "title"];
      const sortCol = allowedSorts.includes(sort) ? sort : "updated_at";
      query = query.order(sortCol, { ascending: order === "asc" }).range(offset, offset + limit - 1);

      const { data, error, count } = await query;
      if (error) return errorJson("INTERNAL", error.message, 500);
      // Notes about a sensitive person leave this page; the filter cannot be
      // expressed on the jsonb list in the query, so total can be the higher
      // of the two by exactly those notes.
      const rows = ((data || []) as Record<string, unknown>[])
        .filter((r) => noteIsVisible({ metadata: { matched_people: r.matched_people } }, visibility))
        .map(({ matched_people: _mp, ...rest }) => rest);
      return json({ data: rows, meta: { total: count || 0, offset, limit } });
    }

    // POST /mc-api-notes — Create
    if (req.method === "POST" && !action) {
      const { body, error: bodyErr } = await readJsonObject(req);
      if (bodyErr) return bodyErr;
      if (!body.title || typeof body.title !== "string") {
        return errorJson("BAD_REQUEST", "title is required", 400);
      }
      // Create treats null and empty as "use the default" (see noteData), so
      // only a present, non-null value has a type to get wrong.
      const present = Object.fromEntries(Object.entries(body).filter(([, v]) => v !== null));
      const { error: fieldErr } = pickTypedFields(present, {
        content: "string",
        entity_type: "string",
        metadata: "object",
        structured_fields: "object",
        source_app: "nullable-string",
        source_id: "nullable-string",
        source_url: "nullable-string",
      });
      if (fieldErr) return fieldErr;

      const noteData: Record<string, unknown> = {
        user_id: userId,
        title: body.title,
        content: body.content || "",
        tags: Array.isArray(body.tags) ? body.tags : [],
        entity_type: body.entity_type || null,
        metadata: body.metadata || {},
        structured_fields: body.structured_fields || {},
        related: body.related || [],
        source_app: body.source_app || "mc-api",
        source_id: body.source_id || null,
        source_url: body.source_url || null,
        folder_path: normalizeFolderPath(body.folder_path),
      };

      let { data, error } = await supabase
        .from("notes")
        .insert(noteData)
        .select("id, title, created_at, updated_at")
        .single();

      // A sender's id (source_app + source_id) is unique per account, and a TRASHED
      // note keeps holding it. So a mission control file that was deleted and later came back
      // under the same path (a git revert, a restored folder) could never be
      // mirrored again: every create answered 400 "duplicate key", hourly, forever.
      // The file is back, so the note comes back: same id, new text, out of the bin.
      // A live note with that id is a real conflict and says which note holds it.
      if (error && (error as { code?: string }).code === "23505" && noteData.source_id) {
        const { data: holder } = await supabase
          .from("notes")
          .select("id, is_trashed")
          .eq("user_id", userId)
          .eq("source_app", noteData.source_app as string)
          .eq("source_id", noteData.source_id as string)
          .maybeSingle();
        if (holder && holder.is_trashed) {
          const { user_id: _owner, ...fields } = noteData;
          const restored = await supabase
            .from("notes")
            .update({ ...fields, is_trashed: false, trashed_at: null })
            .eq("id", holder.id)
            .eq("user_id", userId)
            .select("id, title, created_at, updated_at")
            .single();
          data = restored.data;
          error = restored.error;
        } else if (holder) {
          return errorJson("CONFLICT", `A note with this source_id already exists: ${holder.id}`, 409);
        }
      }

      if (error) return dbErrorResponse(error);
      if (!data) return errorJson("INTERNAL", "The note was not returned after saving", 500);

      // Trigger background processing (embedding, metadata)
      fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/process-note`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ note_id: data.id }),
      }).catch(() => {});

      return json({ data }, 201);
    }

    // PUT /mc-api-notes/{id} — Update
    if (req.method === "PUT" && action) {
      if (!isUuid(action)) return errorJson("NOT_FOUND", "Note not found", 404);
      const { body, error: bodyErr } = await readJsonObject(req);
      if (bodyErr) return bodyErr;

      const { updates, error: fieldErr } = pickTypedFields(body, {
        title: "string",
        content: "string",
        tags: "string-array",
        entity_type: "nullable-string",
        metadata: "object",
        structured_fields: "object",
        is_favorite: "boolean",
        is_pinned: "boolean",
      });
      if (fieldErr) return fieldErr;
      if (body.folder_path !== undefined) {
        updates.folder_path = normalizeFolderPath(body.folder_path);
      }

      if (Object.keys(updates).length === 0) {
        return errorJson("BAD_REQUEST", "No valid fields to update", 400);
      }

      // Trashed notes are invisible to every GET here, so a PUT must not be
      // able to edit (and re-bill processing for) one either.
      const { data, error } = await supabase
        .from("notes")
        .update(updates)
        .eq("id", action)
        .eq("user_id", userId)
        .eq("is_trashed", false)
        .select("id, title, updated_at")
        .maybeSingle();

      if (error) return dbErrorResponse(error);
      if (!data) return errorJson("NOT_FOUND", "Note not found", 404);

      // Re-process in background
      fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/process-note`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ note_id: data.id }),
      }).catch(() => {});

      return json({ data });
    }

    // DELETE /mc-api-notes/{id} — Soft delete
    if (req.method === "DELETE" && action) {
      if (!isUuid(action)) return errorJson("NOT_FOUND", "Note not found", 404);
      // Answering success for an id that is not one of this user's notes told
      // the caller a note was gone that never went anywhere.
      const { data, error } = await supabase
        .from("notes")
        .update({ is_trashed: true, trashed_at: new Date().toISOString() })
        .eq("id", action)
        .eq("user_id", userId)
        .select("id")
        .maybeSingle();

      if (error) return errorJson("INTERNAL", error.message, 500);
      if (!data) return errorJson("NOT_FOUND", "Note not found", 404);
      return json({ data: { success: true } });
    }

    return errorJson("NOT_FOUND", "Endpoint not found", 404);
  } catch (err) {
    return errorJson("INTERNAL", (err as Error).message, 500);
  }
});
