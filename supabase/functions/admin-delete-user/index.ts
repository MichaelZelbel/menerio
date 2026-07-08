// Admin-only deletion of ANOTHER user's account. Mirrors the self-service
// delete-my-account flow (storage + roles + profile + auth user; owned rows
// cascade from the auth.users delete), but authorizes by verifying the CALLER
// holds the "admin" role server-side rather than by password re-auth.
//
// This exists because delete-my-account derives its identity from the caller's
// own JWT and can only delete the caller. The Admin panel previously deleted
// just the `profiles` row, leaving an orphaned auth login and (without cascade)
// owned data behind. This function does the real, complete deletion.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing authorization" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Identify the caller from their JWT.
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user: caller }, error: callerErr } = await userClient.auth.getUser();
    if (callerErr || !caller) return json({ error: "Unauthorized" }, 401);

    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    // Server-side authorization: the caller MUST have the admin role. The
    // client-side AdminRoute gate is not sufficient for a destructive action.
    const { data: callerRole } = await adminClient
      .from("user_roles")
      .select("role")
      .eq("user_id", caller.id)
      .maybeSingle();
    if (callerRole?.role !== "admin") return json({ error: "Forbidden" }, 403);

    const { target_user_id } = await req.json();
    if (!target_user_id || typeof target_user_id !== "string") {
      return json({ error: "target_user_id required" }, 400);
    }

    // An admin deleting their own account through the user table is almost
    // certainly a mistake — route them to account settings instead.
    if (target_user_id === caller.id) {
      return json({ error: "Use account settings to delete your own account." }, 400);
    }

    // Delete avatar files from storage (best-effort).
    const { data: avatarFiles } = await adminClient.storage.from("avatars").list(target_user_id);
    if (avatarFiles && avatarFiles.length > 0) {
      await adminClient.storage.from("avatars").remove(avatarFiles.map((f) => `${target_user_id}/${f.name}`));
    }

    await adminClient.from("user_roles").delete().eq("user_id", target_user_id);
    await adminClient.from("profiles").delete().eq("id", target_user_id);

    // Deleting the auth user cascades owned rows (notes, contacts, …) via their
    // on-delete-cascade FKs to auth.users — same assumption delete-my-account makes.
    const { error: deleteError } = await adminClient.auth.admin.deleteUser(target_user_id);
    if (deleteError) {
      console.error("[admin-delete-user] auth delete failed:", deleteError);
      return json({ error: "Failed to delete user" }, 500);
    }

    console.log(`[admin-delete-user] admin ${caller.id} deleted user ${target_user_id}`);
    return json({ success: true });
  } catch (err) {
    console.error("[admin-delete-user] error:", err);
    return json({ error: "Internal server error" }, 500);
  }
});
