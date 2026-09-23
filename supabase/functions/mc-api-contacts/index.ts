import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authenticateGodspeedKey, requireScope } from "../_shared/mc-auth.ts";
import { checkRateLimit } from "../_shared/mc-rate-limit.ts";
import { ilikeAnyColumn } from "../_shared/postgrest-filters.ts";
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return handleOptions();

  const { result: auth, error: authErr } = await authenticateGodspeedKey(req);
  if (authErr) return authErr;
  const scopeErr = requireScope(auth!.scopes, "contacts");
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
  const subAction = parts[2] || "";

  try {
    // GET /mc-api-contacts/sync-status
    if (req.method === "GET" && action === "sync-status") {
      const { data, error } = await supabase
        .from("contacts")
        .select("updated_at")
        .eq("user_id", userId)
        .order("updated_at", { ascending: false })
        .limit(1);

      const { count, error: countError } = await supabase
        .from("contacts")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId);

      // A failed read used to answer 200 with contact_count 0.
      if (error || countError) return dbErrorResponse((error ?? countError)!);

      return json({
        data: {
          last_modified: data?.[0]?.updated_at || null,
          contact_count: count || 0,
        },
      });
    }

    // POST /mc-api-contacts/{id}/interactions
    if (req.method === "POST" && action && subAction === "interactions") {
      if (!isUuid(action)) return errorJson("NOT_FOUND", "Contact not found", 404);
      // Verify contact belongs to user
      const { data: contact, error: contactError } = await supabase
        .from("contacts")
        .select("id")
        .eq("id", action)
        .eq("user_id", userId)
        .maybeSingle();

      if (contactError) return dbErrorResponse(contactError);
      if (!contact) return errorJson("NOT_FOUND", "Contact not found", 404);

      const { body, error: bodyErr } = await readJsonObject(req);
      if (bodyErr) return bodyErr;
      if (!body.type || typeof body.type !== "string") {
        return errorJson("BAD_REQUEST", "type is required", 400);
      }
      const { error: fieldErr } = pickTypedFields(body, {
        summary: "nullable-string",
        interaction_date: "nullable-date",
        note_id: "nullable-uuid",
      });
      if (fieldErr) return fieldErr;

      // The note id is stored as given with the service key; make sure it is
      // one of this user's notes and not a pointer into someone else's.
      if (body.note_id) {
        const { data: note, error: noteErr } = await supabase
          .from("notes")
          .select("id")
          .eq("id", body.note_id)
          .eq("user_id", userId)
          .maybeSingle();
        if (noteErr) return dbErrorResponse(noteErr);
        if (!note) return errorJson("BAD_REQUEST", "note_id does not match any of your notes", 400);
      }

      const interactionData = {
        contact_id: action,
        user_id: userId,
        type: body.type,
        summary: body.summary || null,
        interaction_date: body.interaction_date || new Date().toISOString().split("T")[0],
        note_id: body.note_id || null,
        action_items: Array.isArray(body.action_items) ? body.action_items : [],
      };

      const { data, error } = await supabase
        .from("contact_interactions")
        .insert(interactionData)
        .select("id, type, summary, interaction_date, created_at")
        .single();

      if (error) return dbErrorResponse(error);

      // Update last_contact_date on the contact
      await supabase
        .from("contacts")
        .update({ last_contact_date: interactionData.interaction_date })
        .eq("id", action)
        .eq("user_id", userId);

      return json({ data }, 201);
    }

    // GET /mc-api-contacts/{id}
    if (req.method === "GET" && action && action !== "sync-status") {
      const { data, error } = await supabase
        .from("contacts")
        .select("*")
        .eq("id", action)
        .eq("user_id", userId)
        .single();

      if (error || !data) return errorJson("NOT_FOUND", "Contact not found", 404);

      // Fetch interactions
      const { data: interactions } = await supabase
        .from("contact_interactions")
        .select("id, type, summary, interaction_date, note_id, action_items, created_at")
        .eq("contact_id", action)
        .eq("user_id", userId)
        .order("interaction_date", { ascending: false })
        .limit(50);

      return json({
        data: { ...data, interactions: interactions || [] },
      }, 200, { "X-Menerio-Modified": data.updated_at || "" });
    }

    // GET /mc-api-contacts — List
    if (req.method === "GET" && !action) {
      const { limit, offset } = paginationParams(url);
      const relationship = url.searchParams.get("relationship");
      const tag = url.searchParams.get("tag");
      const search = url.searchParams.get("q");

      let query = supabase
        .from("contacts")
        .select("id, name, email, phone, company, role, relationship, tags, last_contact_date, contact_frequency_days, created_at, updated_at", { count: "exact" })
        .eq("user_id", userId);

      if (relationship) query = query.eq("relationship", relationship);
      if (tag) query = query.contains("tags", [tag]);
      if (search) query = query.or(ilikeAnyColumn(["name", "email", "company"], search));

      query = query.order("updated_at", { ascending: false }).range(offset, offset + limit - 1);

      const { data, error, count } = await query;
      if (error) return errorJson("INTERNAL", error.message, 500);
      return json({ data, meta: { total: count || 0, offset, limit } });
    }

    // POST /mc-api-contacts — Create
    if (req.method === "POST" && !action) {
      const { body, error: bodyErr } = await readJsonObject(req);
      if (bodyErr) return bodyErr;
      if (!body.name || typeof body.name !== "string") {
        return errorJson("BAD_REQUEST", "name is required", 400);
      }

      const contactData: Record<string, unknown> = {
        user_id: userId,
        name: body.name,
        email: body.email || null,
        phone: body.phone || null,
        company: body.company || null,
        role: body.role || null,
        relationship: body.relationship || null,
        notes: body.notes || null,
        tags: Array.isArray(body.tags) ? body.tags : [],
        metadata: body.metadata || {},
        contact_frequency_days: body.contact_frequency_days || null,
      };

      const { data, error } = await supabase
        .from("contacts")
        .insert(contactData)
        .select("id, name, created_at, updated_at")
        .single();

      if (error) return dbErrorResponse(error);
      return json({ data }, 201);
    }

    // PUT /mc-api-contacts/{id} — Update
    if (req.method === "PUT" && action) {
      if (!isUuid(action)) return errorJson("NOT_FOUND", "Contact not found", 404);
      const { body, error: bodyErr } = await readJsonObject(req);
      if (bodyErr) return bodyErr;

      const { updates, error: fieldErr } = pickTypedFields(body, {
        name: "string",
        email: "nullable-string",
        phone: "nullable-string",
        company: "nullable-string",
        role: "nullable-string",
        relationship: "nullable-string",
        notes: "nullable-string",
        tags: "string-array",
        metadata: "object",
        contact_frequency_days: "nullable-positive-int",
        last_contact_date: "nullable-date",
      });
      if (fieldErr) return fieldErr;
      if (typeof updates.name === "string" && updates.name.trim() === "") {
        return errorJson("BAD_REQUEST", "name cannot be empty", 400);
      }

      if (Object.keys(updates).length === 0) {
        return errorJson("BAD_REQUEST", "No valid fields to update", 400);
      }

      const { data, error } = await supabase
        .from("contacts")
        .update(updates)
        .eq("id", action)
        .eq("user_id", userId)
        .select("id, name, updated_at")
        .maybeSingle();

      if (error) return dbErrorResponse(error);
      if (!data) return errorJson("NOT_FOUND", "Contact not found", 404);
      return json({ data });
    }

    // DELETE /mc-api-contacts/{id}
    if (req.method === "DELETE" && action) {
      if (!isUuid(action)) return errorJson("NOT_FOUND", "Contact not found", 404);
      // Success for an id that is not one of this user's contacts said a
      // person was deleted who was never touched.
      const { data, error } = await supabase
        .from("contacts")
        .delete()
        .eq("id", action)
        .eq("user_id", userId)
        .select("id")
        .maybeSingle();

      if (error) return errorJson("INTERNAL", error.message, 500);
      if (!data) return errorJson("NOT_FOUND", "Contact not found", 404);
      return json({ data: { success: true } });
    }

    return errorJson("NOT_FOUND", "Endpoint not found", 404);
  } catch (err) {
    return errorJson("INTERNAL", (err as Error).message, 500);
  }
});
