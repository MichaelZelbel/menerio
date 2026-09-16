import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { removeUserStorage } from "../_shared/delete-user-storage.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Create client with user's token to get their identity
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const {
      data: { user },
      error: userError,
    } = await userClient.auth.getUser();

    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Prove it is really them. An account with a password re-enters it. An
    // account that only ever signed in with Google or GitHub has no password,
    // and the old check answered every such user "Invalid password": they
    // could not delete their own data at all. They confirm by typing their
    // e-mail address exactly instead.
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const { password, confirm_email } = body as { password?: string; confirm_email?: string };
    const hasPassword = (user.identities ?? []).some((i) => i.provider === "email");

    if (hasPassword) {
      if (!password) {
        return new Response(JSON.stringify({ error: "Password required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { error: signInError } = await createClient(supabaseUrl, supabaseAnonKey)
        .auth.signInWithPassword({ email: user.email!, password });
      if (signInError) {
        return new Response(JSON.stringify({ error: "Invalid password" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    } else {
      const typed = String(confirm_email ?? "").trim().toLowerCase();
      if (!typed || typed !== String(user.email ?? "").trim().toLowerCase()) {
        return new Response(JSON.stringify({ error: "Type your account e-mail address exactly to confirm" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Notify admin before deletion (best-effort, never blocks deletion)
    try {
      console.log("[DELETE-ACCOUNT] Sending delete_account notification for", user.email);
      const notifyRes = await fetch(`${supabaseUrl}/functions/v1/notify-admin`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${supabaseServiceKey}`,
        },
        body: JSON.stringify({
          eventType: "delete_account",
          userEmail: user.email,
          userId: user.id,
          displayName: user.user_metadata?.full_name || user.user_metadata?.name || "Unknown",
        }),
      });
      console.log("[DELETE-ACCOUNT] Notification response status:", notifyRes.status);
    } catch (notifyErr) {
      console.error("[DELETE-ACCOUNT] Notification failed (continuing with deletion):", notifyErr);
    }

    // Use service role client for deletion
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    // Every file of theirs: avatars and note attachments (clips, scans, uploads).
    const storage = await removeUserStorage(adminClient, user.id);
    for (const err of storage.errors) console.error("[DELETE-ACCOUNT] storage cleanup:", err);

    // Delete user roles
    await adminClient.from("user_roles").delete().eq("user_id", user.id);

    // Delete profile
    await adminClient.from("profiles").delete().eq("id", user.id);

    // Delete auth user
    const { error: deleteError } = await adminClient.auth.admin.deleteUser(user.id);

    if (deleteError) {
      return new Response(JSON.stringify({ error: "Failed to delete account" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
