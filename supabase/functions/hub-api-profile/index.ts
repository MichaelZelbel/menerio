import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2/cors";
import { authenticateHubKey, requireScope } from "../_shared/hub-auth.ts";
import { checkRateLimit } from "../_shared/hub-rate-limit.ts";

const headers = { ...corsHeaders, "Content-Type": "application/json" };

function json(data: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), { status, headers: { ...headers, ...extra } });
}

function parsePath(url: string): string[] {
  return new URL(url).pathname.split("/").filter(Boolean).slice(1); // skip function name
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Auth
  const { result: auth, error: authError } = await authenticateHubKey(req);
  if (authError) return authError;
  if (!auth) return json({ error: "Unauthorized" }, 401);

  // Scope check
  const scopeErr = requireScope(auth.scopes, "profile");
  if (scopeErr) return scopeErr;

  // Rate limit
  const rateLimitErr = await checkRateLimit(auth.keyId);
  if (rateLimitErr) return rateLimitErr;

  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const userId = auth.userId;
  const url = new URL(req.url);
  const parts = parsePath(req.url);
  const resource = parts[0] || "";
  const resourceId = parts[1] || "";
  const method = req.method;
  const scope = url.searchParams.get("scope");

  try {
    // ── FULL PROFILE ──
    if (resource === "full" && method === "GET") {
      let catQuery = supabaseAdmin.from("profile_categories").select("id, name, slug, icon, description, sort_order, visibility_scope").eq("user_id", userId).order("sort_order");
      if (scope) catQuery = catQuery.eq("visibility_scope", scope);
      const { data: categories } = await catQuery;

      const categoryIds = (categories || []).map((c: any) => c.id);

      let entQuery = supabaseAdmin.from("profile_entries").select("id, category_id, label, value, linked_note_id, sort_order").eq("user_id", userId).order("sort_order");
      if (categoryIds.length > 0 && scope) {
        entQuery = entQuery.in("category_id", categoryIds);
      }
      const { data: entries } = await entQuery;

      let instrQuery = supabaseAdmin.from("agent_instructions").select("id, instruction, applies_to, is_active, sort_order").eq("user_id", userId).order("sort_order");
      if (scope) instrQuery = instrQuery.eq("applies_to", scope);
      const { data: instructions } = await instrQuery;

      const { data: views } = await supabaseAdmin.from("profile_views").select("id, name, slug, description, included_scopes").eq("user_id", userId);

      const lastMod = getLastModified(categories, entries, instructions);

      return json({ categories, entries, instructions, views }, 200, { "X-Menerio-Modified": lastMod });
    }

    // ── SYNC STATUS ──
    if (resource === "sync-status" && method === "GET") {
      const { data: categories } = await supabaseAdmin.from("profile_categories").select("id, updated_at").eq("user_id", userId);
      const { data: entries } = await supabaseAdmin.from("profile_entries").select("id, label, value, updated_at").eq("user_id", userId).order("id");

      const entryCount = entries?.length || 0;
      const categoryCount = categories?.length || 0;

      // Simple checksum from sorted entry data
      const checksumInput = (entries || []).map((e: any) => `${e.id}:${e.label}:${e.value}`).join("|");
      const encoder = new TextEncoder();
      const hashBuffer = await crypto.subtle.digest("SHA-256", encoder.encode(checksumInput));
      const checksum = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("");

      const allDates = [
        ...(categories || []).map((c: any) => c.updated_at),
        ...(entries || []).map((e: any) => e.updated_at),
      ].filter(Boolean);
      const lastModified = allDates.length > 0 ? allDates.sort().reverse()[0] : new Date().toISOString();

      return json({ last_modified: lastModified, entry_count: entryCount, category_count: categoryCount, checksum }, 200, { "X-Menerio-Modified": lastModified });
    }

    // ── CATEGORIES ──
    if (resource === "categories") {
      if (method === "GET" && !resourceId) {
        let query = supabaseAdmin.from("profile_categories").select("id, name, slug, icon, description, sort_order, visibility_scope").eq("user_id", userId).order("sort_order");
        if (scope) query = query.eq("visibility_scope", scope);
        const { data, error } = await query;
        if (error) return json({ error: error.message }, 500);
        return json(data);
      }

      if (method === "POST" && !resourceId) {
        const body = await req.json();
        if (!body.name || !body.slug) return json({ error: "name and slug are required" }, 400);
        const { data, error } = await supabaseAdmin.from("profile_categories").insert({
          user_id: userId, name: body.name, slug: body.slug,
          icon: body.icon || null, description: body.description || null,
          sort_order: body.sort_order ?? 0, visibility_scope: body.visibility_scope || "all",
        }).select().single();
        if (error) return json({ error: error.message }, error.message.includes("duplicate") ? 409 : 500);
        return json(data, 201);
      }

      if (method === "PUT" && resourceId) {
        const body = await req.json();
        const { data, error } = await supabaseAdmin.from("profile_categories").update({
          ...(body.name !== undefined && { name: body.name }),
          ...(body.slug !== undefined && { slug: body.slug }),
          ...(body.icon !== undefined && { icon: body.icon }),
          ...(body.description !== undefined && { description: body.description }),
          ...(body.sort_order !== undefined && { sort_order: body.sort_order }),
          ...(body.visibility_scope !== undefined && { visibility_scope: body.visibility_scope }),
        }).eq("id", resourceId).eq("user_id", userId).select().single();
        if (error) return json({ error: error.message }, 500);
        if (!data) return json({ error: "Not found" }, 404);
        return json(data);
      }

      if (method === "DELETE" && resourceId) {
        // Delete entries first, then category
        await supabaseAdmin.from("profile_entries").delete().eq("category_id", resourceId).eq("user_id", userId);
        const { error } = await supabaseAdmin.from("profile_categories").delete().eq("id", resourceId).eq("user_id", userId);
        if (error) return json({ error: error.message }, 500);
        return json({ success: true });
      }
    }

    // ── ENTRIES ──
    if (resource === "entries") {
      if (method === "GET" && !resourceId) {
        let query = supabaseAdmin.from("profile_entries").select("id, category_id, label, value, linked_note_id, sort_order").eq("user_id", userId).order("sort_order");
        const categoryId = url.searchParams.get("category_id");
        if (categoryId) query = query.eq("category_id", categoryId);
        if (scope) {
          // Filter by categories matching scope
          const { data: cats } = await supabaseAdmin.from("profile_categories").select("id").eq("user_id", userId).eq("visibility_scope", scope);
          const catIds = (cats || []).map((c: any) => c.id);
          if (catIds.length > 0) query = query.in("category_id", catIds);
          else return json([]);
        }
        const { data, error } = await query;
        if (error) return json({ error: error.message }, 500);
        return json(data);
      }

      if (method === "POST" && !resourceId) {
        const body = await req.json();
        if (!body.category_id || !body.label || body.value === undefined) {
          return json({ error: "category_id, label, and value are required" }, 400);
        }
        const { data, error } = await supabaseAdmin.from("profile_entries").insert({
          user_id: userId, category_id: body.category_id, label: body.label,
          value: body.value, linked_note_id: body.linked_note_id || null,
          sort_order: body.sort_order ?? 0,
        }).select().single();
        if (error) return json({ error: error.message }, 500);
        return json(data, 201);
      }

      // Batch upsert
      if (method === "PUT" && resourceId === "batch") {
        const body = await req.json();
        if (!Array.isArray(body.entries) || body.entries.length === 0) {
          return json({ error: "entries array is required" }, 400);
        }
        const rows = body.entries.map((e: any) => ({
          ...(e.id && { id: e.id }),
          user_id: userId,
          category_id: e.category_id,
          label: e.label,
          value: e.value,
          linked_note_id: e.linked_note_id || null,
          sort_order: e.sort_order ?? 0,
        }));
        const { data, error } = await supabaseAdmin.from("profile_entries").upsert(rows, { onConflict: "id" }).select();
        if (error) return json({ error: error.message }, 500);
        return json({ upserted: data?.length || 0, entries: data });
      }

      if (method === "PUT" && resourceId && resourceId !== "batch") {
        const body = await req.json();
        const { data, error } = await supabaseAdmin.from("profile_entries").update({
          ...(body.label !== undefined && { label: body.label }),
          ...(body.value !== undefined && { value: body.value }),
          ...(body.linked_note_id !== undefined && { linked_note_id: body.linked_note_id }),
          ...(body.sort_order !== undefined && { sort_order: body.sort_order }),
          ...(body.category_id !== undefined && { category_id: body.category_id }),
        }).eq("id", resourceId).eq("user_id", userId).select().single();
        if (error) return json({ error: error.message }, 500);
        if (!data) return json({ error: "Not found" }, 404);
        return json(data);
      }

      if (method === "DELETE" && resourceId) {
        const { error } = await supabaseAdmin.from("profile_entries").delete().eq("id", resourceId).eq("user_id", userId);
        if (error) return json({ error: error.message }, 500);
        return json({ success: true });
      }
    }

    // ── INSTRUCTIONS ──
    if (resource === "instructions") {
      if (method === "GET" && !resourceId) {
        let query = supabaseAdmin.from("agent_instructions").select("id, instruction, applies_to, is_active, sort_order").eq("user_id", userId).order("sort_order");
        const appliesTo = url.searchParams.get("applies_to");
        if (appliesTo) query = query.eq("applies_to", appliesTo);
        const { data, error } = await query;
        if (error) return json({ error: error.message }, 500);
        return json(data);
      }

      if (method === "POST" && !resourceId) {
        const body = await req.json();
        if (!body.instruction) return json({ error: "instruction is required" }, 400);
        const { data, error } = await supabaseAdmin.from("agent_instructions").insert({
          user_id: userId, instruction: body.instruction,
          applies_to: body.applies_to || "all",
          is_active: body.is_active ?? true,
          sort_order: body.sort_order ?? 0,
        }).select().single();
        if (error) return json({ error: error.message }, 500);
        return json(data, 201);
      }

      if (method === "PUT" && resourceId) {
        const body = await req.json();
        const { data, error } = await supabaseAdmin.from("agent_instructions").update({
          ...(body.instruction !== undefined && { instruction: body.instruction }),
          ...(body.applies_to !== undefined && { applies_to: body.applies_to }),
          ...(body.is_active !== undefined && { is_active: body.is_active }),
          ...(body.sort_order !== undefined && { sort_order: body.sort_order }),
        }).eq("id", resourceId).eq("user_id", userId).select().single();
        if (error) return json({ error: error.message }, 500);
        if (!data) return json({ error: "Not found" }, 404);
        return json(data);
      }

      if (method === "DELETE" && resourceId) {
        const { error } = await supabaseAdmin.from("agent_instructions").delete().eq("id", resourceId).eq("user_id", userId);
        if (error) return json({ error: error.message }, 500);
        return json({ success: true });
      }
    }

    return json({ error: "Not found" }, 404);
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});

function getLastModified(...arrays: (any[] | null | undefined)[]): string {
  const dates: string[] = [];
  for (const arr of arrays) {
    if (!arr) continue;
    for (const item of arr) {
      if (item.updated_at) dates.push(item.updated_at);
      if (item.created_at) dates.push(item.created_at);
    }
  }
  if (dates.length === 0) return new Date().toISOString();
  return dates.sort().reverse()[0];
}
