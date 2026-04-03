import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-bridge-key, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Auth via bridge key
    const bridgeKey = req.headers.get("x-bridge-key");

    // Check against all known bridge keys
    const CLARINIO_BRIDGE_KEY = Deno.env.get("CLARINIO_BRIDGE_KEY");
    const TEMERIO_BRIDGE_KEY = Deno.env.get("TEMERIO_BRIDGE_KEY");

    const validKeys = [CLARINIO_BRIDGE_KEY, TEMERIO_BRIDGE_KEY].filter(Boolean);

    if (!bridgeKey || !validKeys.includes(bridgeKey)) {
      return json({ error: "unauthorized" }, 401);
    }

    const body = await req.json();
    const { email, source, categories, entries, instructions } = body;

    if (!email || typeof email !== "string") {
      return json({ error: "email is required" }, 400);
    }
    if (!source || typeof source !== "string") {
      return json({ error: "source is required" }, 400);
    }
    if (!Array.isArray(categories)) {
      return json({ error: "categories must be an array" }, 400);
    }

    // Look up user by email
    const { data: authUsers } = await supabase.auth.admin.listUsers();
    const targetUser = authUsers?.users?.find((u) => u.email === email);
    if (!targetUser) {
      return json({ error: "user not found" }, 404);
    }
    const userId = targetUser.id;

    // --- Sync categories ---
    // Get existing categories for this user
    const { data: existingCats } = await supabase
      .from("profile_categories")
      .select("*")
      .eq("user_id", userId);

    const existingBySlug = new Map((existingCats || []).map((c: any) => [c.slug, c]));

    let categoriesCreated = 0;
    let categoriesUpdated = 0;
    const slugToId = new Map<string, string>();

    for (const cat of categories) {
      const existing = existingBySlug.get(cat.slug);
      if (existing) {
        // Update if data differs
        const { error } = await supabase
          .from("profile_categories")
          .update({
            name: cat.name,
            icon: cat.icon,
            description: cat.description,
            sort_order: cat.sort_order,
            visibility_scope: cat.visibility_scope,
          })
          .eq("id", existing.id);
        if (error) console.error("Update category error:", error);
        else categoriesUpdated++;
        slugToId.set(cat.slug, existing.id);
      } else {
        // Insert new
        const { data: inserted, error } = await supabase
          .from("profile_categories")
          .insert({
            user_id: userId,
            slug: cat.slug,
            name: cat.name,
            icon: cat.icon || null,
            description: cat.description || null,
            sort_order: cat.sort_order ?? 0,
            visibility_scope: cat.visibility_scope || "all",
            is_default: cat.is_default ?? false,
          })
          .select("id")
          .single();
        if (error) console.error("Insert category error:", error);
        else {
          categoriesCreated++;
          slugToId.set(cat.slug, inserted!.id);
        }
      }
    }

    // --- Sync entries ---
    let entriesCreated = 0;
    let entriesUpdated = 0;

    if (Array.isArray(entries)) {
      for (const entry of entries) {
        const categoryId = slugToId.get(entry.category_slug);
        if (!categoryId) {
          console.warn(`Skipping entry "${entry.label}" — category slug "${entry.category_slug}" not found`);
          continue;
        }

        // Check if entry with same label in same category exists
        const { data: existingEntry } = await supabase
          .from("profile_entries")
          .select("id")
          .eq("user_id", userId)
          .eq("category_id", categoryId)
          .eq("label", entry.label)
          .maybeSingle();

        if (existingEntry) {
          const { error } = await supabase
            .from("profile_entries")
            .update({
              value: entry.value,
              sort_order: entry.sort_order ?? 0,
            })
            .eq("id", existingEntry.id);
          if (error) console.error("Update entry error:", error);
          else entriesUpdated++;
        } else {
          const { error } = await supabase
            .from("profile_entries")
            .insert({
              user_id: userId,
              category_id: categoryId,
              label: entry.label,
              value: entry.value,
              sort_order: entry.sort_order ?? 0,
            });
          if (error) console.error("Insert entry error:", error);
          else entriesCreated++;
        }
      }
    }

    // --- Sync instructions ---
    let instructionsCreated = 0;
    let instructionsUpdated = 0;

    if (Array.isArray(instructions)) {
      for (const inst of instructions) {
        // Match by instruction text
        const { data: existingInst } = await supabase
          .from("agent_instructions")
          .select("id")
          .eq("user_id", userId)
          .eq("instruction", inst.instruction)
          .maybeSingle();

        if (existingInst) {
          const { error } = await supabase
            .from("agent_instructions")
            .update({
              applies_to: inst.applies_to ?? "all",
              is_active: inst.is_active ?? true,
              sort_order: inst.sort_order ?? 0,
            })
            .eq("id", existingInst.id);
          if (error) console.error("Update instruction error:", error);
          else instructionsUpdated++;
        } else {
          const { error } = await supabase
            .from("agent_instructions")
            .insert({
              user_id: userId,
              instruction: inst.instruction,
              applies_to: inst.applies_to ?? "all",
              is_active: inst.is_active ?? true,
              sort_order: inst.sort_order ?? 0,
            });
          if (error) console.error("Insert instruction error:", error);
          else instructionsCreated++;
        }
      }
    }

    return json({
      ok: true,
      categories: { created: categoriesCreated, updated: categoriesUpdated },
      entries: { created: entriesCreated, updated: entriesUpdated },
      instructions: { created: instructionsCreated, updated: instructionsUpdated },
    });
  } catch (err) {
    console.error("receive-profile error:", err);
    return json({ error: (err as Error).message || "Internal error" }, 500);
  }
});
