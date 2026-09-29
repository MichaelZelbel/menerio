import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const token = url.searchParams.get("token");

    if (!token || token.length < 8) {
      return new Response(
        JSON.stringify({ error: "Invalid or missing token" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // The same join get_shared_note_by_token makes, plus the trash. That
    // function never looked at is_trashed, so a note its owner had moved to
    // the bin went on being served to everyone holding the link until the
    // bin was emptied. The link stays active: restoring the note brings it back.
    const { data: share, error: shareError } = await supabase
      .from("shared_notes")
      .select("note_id, user_id")
      .eq("share_token", token)
      .eq("is_active", true)
      .maybeSingle();
    if (shareError) throw shareError;

    let data: Record<string, unknown> | null = null;
    if (share) {
      const { data: note, error: noteError } = await supabase
        .from("notes")
        .select("title, content, tags, entity_type, created_at, updated_at")
        .eq("id", share.note_id)
        .eq("user_id", share.user_id)
        .eq("is_trashed", false)
        .maybeSingle();
      if (noteError) throw noteError;
      data = note;
    }

    if (!data) {
      return new Response(
        JSON.stringify({ error: "Note not found or sharing disabled" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("get-shared-note error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
