import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

/**
 * PDF analysis edge function.
 * Since Deno edge functions can't do full PDF-to-image conversion,
 * we send the PDF directly to the vision model which supports PDF input.
 * For multi-page PDFs, we analyze the whole document as one unit.
 */
async function processPdf(
  noteId: string,
  storagePath: string,
  originalFilename: string | null,
  userId: string,
  authHeader: string
) {
  try {
    // Trigger analyze-media with media_type "pdf" — the vision model
    // (gpt-4o-mini) can handle PDF content sent as base64
    const analyzeUrl = `${SUPABASE_URL}/functions/v1/analyze-media`;
    const resp = await fetch(analyzeUrl, {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        note_id: noteId,
        storage_path: storagePath,
        media_type: "pdf",
        original_filename: originalFilename,
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      console.error(`analyze-pdf: analyze-media call failed: ${resp.status} ${errText}`);
    } else {
      console.log(`analyze-pdf: triggered analysis for note=${noteId}, path=${storagePath}`);
    }
  } catch (err) {
    console.error("analyze-pdf background error:", err);
  }
}

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
    const token = authHeader.replace("Bearer ", "");
    const {
      data: { user },
      error: authErr,
    } = await supabase.auth.getUser(token);
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { note_id, storage_path, original_filename } = body;

    if (!note_id || !storage_path) {
      return new Response(
        JSON.stringify({ error: "note_id and storage_path are required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // @ts-ignore EdgeRuntime
    EdgeRuntime.waitUntil(
      processPdf(note_id, storage_path, original_filename ?? null, user.id, authHeader)
    );

    return new Response(
      JSON.stringify({ ok: true, processing: true }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err: any) {
    console.error("analyze-pdf handler error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
