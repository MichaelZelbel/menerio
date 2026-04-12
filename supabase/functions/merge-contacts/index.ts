import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify user
    const supabaseAuth = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authErr } = await supabaseAuth.auth.getUser(token);
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { source_contact_id, target_contact_id, merge_into_self } = await req.json();

    if (!source_contact_id) {
      return new Response(JSON.stringify({ error: "source_contact_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!target_contact_id && !merge_into_self) {
      return new Response(JSON.stringify({ error: "target_contact_id or merge_into_self required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const userId = user.id;

    // Verify source contact belongs to user and is not already merged
    const { data: source, error: srcErr } = await supabase
      .from("contacts")
      .select("*")
      .eq("id", source_contact_id)
      .eq("user_id", userId)
      .is("merged_into", null)
      .single();

    if (srcErr || !source) {
      return new Response(JSON.stringify({ error: "Source contact not found or already merged" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let targetContactId: string | null = target_contact_id || null;
    let targetName: string;

    if (merge_into_self) {
      // Merging into user profile — no target contact
      targetContactId = null;
      targetName = "yourself";
    } else {
      // Verify target contact belongs to user and is not merged
      const { data: target, error: tgtErr } = await supabase
        .from("contacts")
        .select("id, name, aliases, app_mappings")
        .eq("id", target_contact_id)
        .eq("user_id", userId)
        .is("merged_into", null)
        .single();

      if (tgtErr || !target) {
        return new Response(JSON.stringify({ error: "Target contact not found or already merged" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      targetName = target.name;

      // a) Merge aliases: add source name + aliases to target aliases
      const sourceNames = [source.name, ...(source.aliases || [])];
      const targetAliases = new Set<string>((target.aliases || []) as string[]);
      // Don't add the target's own name as an alias
      for (const n of sourceNames) {
        if (n && n.toLowerCase() !== target.name.toLowerCase()) {
          targetAliases.add(n);
        }
      }

      // b) Merge app_mappings
      const srcMappings = (source.app_mappings || {}) as Record<string, any>;
      const tgtMappings = (target.app_mappings || {}) as Record<string, any>;
      const mergedMappings = { ...tgtMappings };
      for (const [key, val] of Object.entries(srcMappings)) {
        if (!mergedMappings[key] || !mergedMappings[key].display_name) {
          mergedMappings[key] = val;
        }
      }

      // c) Merge notes text (append if source has notes)
      let mergedNotes = target.name ? "" : "";
      const { data: targetFull } = await supabase
        .from("contacts")
        .select("notes")
        .eq("id", target_contact_id)
        .single();
      const tgtNotes = (targetFull?.notes || "").trim();
      const srcNotes = (source.notes || "").trim();
      if (tgtNotes && srcNotes) {
        mergedNotes = `${tgtNotes}\n\n--- Merged from ${source.name} ---\n${srcNotes}`;
      } else {
        mergedNotes = tgtNotes || srcNotes || "";
      }

      // Update target contact
      await supabase
        .from("contacts")
        .update({
          aliases: [...targetAliases],
          app_mappings: mergedMappings,
          notes: mergedNotes || null,
        })
        .eq("id", target_contact_id);
    }

    // d) Move profile_categories and profile_entries from source to target
    if (merge_into_self) {
      // Moving to user profile means setting contact_id = null
      // But we need to handle slug conflicts with user's own categories
      const { data: srcCategories } = await supabase
        .from("profile_categories")
        .select("*")
        .eq("user_id", userId)
        .eq("contact_id", source_contact_id);

      if (srcCategories && srcCategories.length > 0) {
        // Get user's own categories (contact_id IS NULL)
        const { data: userCategories } = await supabase
          .from("profile_categories")
          .select("id, slug")
          .eq("user_id", userId)
          .is("contact_id", null);

        const userCatBySlug = new Map((userCategories || []).map((c: any) => [c.slug, c.id]));

        for (const srcCat of srcCategories as any[]) {
          const existingCatId = userCatBySlug.get(srcCat.slug);
          if (existingCatId) {
            // Move entries to user's existing category
            await supabase
              .from("profile_entries")
              .update({ category_id: existingCatId, contact_id: null })
              .eq("category_id", srcCat.id)
              .eq("contact_id", source_contact_id);
          } else {
            // Move the whole category to user profile
            await supabase
              .from("profile_categories")
              .update({ contact_id: null })
              .eq("id", srcCat.id);
            await supabase
              .from("profile_entries")
              .update({ contact_id: null })
              .eq("category_id", srcCat.id)
              .eq("contact_id", source_contact_id);
          }
        }

        // Clean up source categories that were remapped
        await supabase
          .from("profile_categories")
          .delete()
          .eq("user_id", userId)
          .eq("contact_id", source_contact_id);
      }

      // Move aliases to user profile (store in user's profiles metadata or just in contact before marking)
      // For merge-into-self, add source name/aliases as user profile entries under "identity"
      const { data: userIdentityCat } = await supabase
        .from("profile_categories")
        .select("id")
        .eq("user_id", userId)
        .is("contact_id", null)
        .eq("slug", "identity")
        .single();

      if (userIdentityCat) {
        const sourceNames = [source.name, ...(source.aliases || [])].filter(Boolean);
        for (const alias of sourceNames) {
          // Check if already exists
          const { data: existing } = await supabase
            .from("profile_entries")
            .select("id")
            .eq("user_id", userId)
            .is("contact_id", null)
            .eq("category_id", userIdentityCat.id)
            .eq("label", "Also known as")
            .eq("value", alias)
            .maybeSingle();

          if (!existing) {
            await supabase.from("profile_entries").insert({
              user_id: userId,
              contact_id: null,
              category_id: userIdentityCat.id,
              label: "Also known as",
              value: alias,
              sort_order: 99,
            });
          }
        }
      }
    } else {
      // Moving to another contact
      const { data: srcCategories } = await supabase
        .from("profile_categories")
        .select("*")
        .eq("user_id", userId)
        .eq("contact_id", source_contact_id);

      if (srcCategories && srcCategories.length > 0) {
        const { data: tgtCategories } = await supabase
          .from("profile_categories")
          .select("id, slug")
          .eq("user_id", userId)
          .eq("contact_id", targetContactId!);

        const tgtCatBySlug = new Map((tgtCategories || []).map((c: any) => [c.slug, c.id]));

        for (const srcCat of srcCategories as any[]) {
          const existingCatId = tgtCatBySlug.get(srcCat.slug);
          if (existingCatId) {
            // Move entries to target's existing category
            await supabase
              .from("profile_entries")
              .update({ category_id: existingCatId, contact_id: targetContactId })
              .eq("category_id", srcCat.id)
              .eq("contact_id", source_contact_id);
          } else {
            // Move the whole category to target
            await supabase
              .from("profile_categories")
              .update({ contact_id: targetContactId })
              .eq("id", srcCat.id);
            await supabase
              .from("profile_entries")
              .update({ contact_id: targetContactId })
              .eq("category_id", srcCat.id)
              .eq("contact_id", source_contact_id);
          }
        }

        // Clean up remapped source categories
        await supabase
          .from("profile_categories")
          .delete()
          .eq("user_id", userId)
          .eq("contact_id", source_contact_id);
      }
    }

    // e) Reassign action_items from source contact to target
    if (merge_into_self) {
      await supabase
        .from("action_items")
        .update({ contact_id: null })
        .eq("contact_id", source_contact_id)
        .eq("user_id", userId);
    } else {
      await supabase
        .from("action_items")
        .update({ contact_id: targetContactId })
        .eq("contact_id", source_contact_id)
        .eq("user_id", userId);
    }

    // f) Reassign contact_interactions
    if (!merge_into_self && targetContactId) {
      await supabase
        .from("contact_interactions")
        .update({ contact_id: targetContactId })
        .eq("contact_id", source_contact_id)
        .eq("user_id", userId);
    }

    // g) Update note metadata: replace source person references with target
    const { data: allNotes } = await supabase
      .from("notes")
      .select("id, metadata")
      .eq("user_id", userId)
      .eq("is_trashed", false);

    const sourceNames = new Set(
      [source.name, ...(source.aliases || [])].map((n: string) => n?.toLowerCase()).filter(Boolean)
    );

    for (const note of (allNotes || []) as any[]) {
      const meta = note.metadata || {};
      let changed = false;

      // Update metadata.people array
      if (Array.isArray(meta.people)) {
        const newPeople = meta.people.map((p: string) =>
          sourceNames.has(p.toLowerCase()) ? (merge_into_self ? null : targetName) : p
        ).filter(Boolean);
        if (JSON.stringify(newPeople) !== JSON.stringify(meta.people)) {
          meta.people = [...new Set(newPeople)];
          changed = true;
        }
      }

      // Update metadata.matched_people array
      if (Array.isArray(meta.matched_people)) {
        const newMatched = meta.matched_people.map((mp: any) => {
          if (mp.contact_id === source_contact_id) {
            if (merge_into_self) return null;
            return { ...mp, contact_id: targetContactId, canonical_name: targetName };
          }
          return mp;
        }).filter(Boolean);
        if (JSON.stringify(newMatched) !== JSON.stringify(meta.matched_people)) {
          meta.matched_people = newMatched;
          changed = true;
        }
      }

      if (changed) {
        await supabase.from("notes").update({ metadata: meta }).eq("id", note.id);
      }
    }

    // h) Mark source as merged
    const mergeTarget = merge_into_self ? "self" : targetContactId;
    await supabase
      .from("contacts")
      .update({
        merged_into: merge_into_self ? source_contact_id : targetContactId,
        merged_at: new Date().toISOString(),
      } as any)
      .eq("id", source_contact_id);

    // For merge-into-self, we set merged_into to self (the contact's own ID) as a sentinel
    // since the column references contacts(id), we can't use a non-contact UUID

    return new Response(
      JSON.stringify({
        ok: true,
        merged: {
          source: source.name,
          target: merge_into_self ? "user profile" : targetName,
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    console.error("merge-contacts error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
