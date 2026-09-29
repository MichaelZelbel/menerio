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
 * Thin wrapper around analyze-media. PDFs are processed via Mistral OCR
 * (mistral-ocr-latest) which extracts per-page markdown text and embedded
 * images; each page becomes its own media_analysis record.
 *
 * analyze-media checks the note and the storage path and answers at once (the
 * OCR itself runs in its background), so its answer is awaited and passed on.
 * This used to fire it in the background and answer 200 "processing" even when
 * analyze-media refused the request (a path outside the caller's folder, a
 * note that is not theirs) and nothing was ever analysed.
 */
async function triggerAnalysis(
  noteId: string,
  storagePath: string,
  originalFilename: string | null,
  authHeader: string
): Promise<Response> {
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
  const text = await resp.text().catch(() => "");
  if (!resp.ok) {
    console.error(`analyze-pdf: analyze-media call failed: ${resp.status} ${text}`);
  } else {
    console.log(`analyze-pdf: triggered analysis for note=${noteId}, path=${storagePath}`);
  }
  const fallback = resp.ok ? { ok: true, processing: true } : { error: "Analysis could not be started" };
  return new Response(text || JSON.stringify(fallback), {
    status: resp.status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
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

    return await triggerAnalysis(note_id, storage_path, original_filename ?? null, authHeader);
  } catch (err: any) {
    console.error("analyze-pdf handler error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
