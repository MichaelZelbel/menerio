import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { selectAllRows } from "../_shared/paged-select.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * Parse note HTML content to find embedded images and PDFs.
 * Returns storage paths (relative to note-attachments bucket).
 */
function extractMediaFromContent(content: string): { path: string; type: string }[] {
  const results: { path: string; type: string }[] = [];
  const seen = new Set<string>();

  // Match image src attributes pointing to our storage
  const imgRegex = /src="[^"]*\/storage\/v1\/object\/public\/note-attachments\/([^"]+)"/g;
  let match: RegExpExecArray | null;
  while ((match = imgRegex.exec(content)) !== null) {
    const path = decodeURIComponent(match[1]);
    if (!seen.has(path)) {
      seen.add(path);
      const ext = path.split(".").pop()?.toLowerCase() || "";
      const type = ext === "pdf" ? "pdf" : "image";
      results.push({ path, type });
    }
  }

  // Match PDF embeds (iframe data-type="pdf")
  const pdfRegex = /data-type="pdf"[^>]*src="[^"]*\/storage\/v1\/object\/public\/note-attachments\/([^"]+)"/g;
  while ((match = pdfRegex.exec(content)) !== null) {
    const path = decodeURIComponent(match[1]);
    if (!seen.has(path)) {
      seen.add(path);
      results.push({ path, type: "pdf" });
    }
  }

  // Also match href links to PDFs
  const hrefRegex = /href="[^"]*\/storage\/v1\/object\/public\/note-attachments\/([^"]*\.pdf[^"]*)"/gi;
  while ((match = hrefRegex.exec(content)) !== null) {
    const path = decodeURIComponent(match[1]);
    if (!seen.has(path)) {
      seen.add(path);
      results.push({ path, type: "pdf" });
    }
  }

  return results;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) return json({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const mode = body.mode || "scan"; // "scan" = just count, "run" = process
    const batchSize = body.batch_size || 5;
    const delayMs = body.delay_ms || 2000;

    // Step 1: Scan all user's notes for media
    // Paged: unpaged, notes past the first 1,000 were never scanned and the
    // counts below looked complete.
    const notes = await selectAllRows<{ id: string; content: string | null }>(
      (from, to) =>
        supabase
          .from("notes")
          .select("id, content")
          .eq("user_id", user.id)
          .eq("is_trashed", false)
          .order("id")
          .range(from, to),
      500,
    );

    // Step 2: Extract all media references
    const allMedia: { noteId: string; path: string; type: string }[] = [];
    for (const note of notes || []) {
      if (!note.content) continue;
      const media = extractMediaFromContent(note.content);
      for (const m of media) {
        allMedia.push({ noteId: note.id, path: m.path, type: m.type });
      }
    }

    // Step 3: Cross-reference with existing media_analysis records
    // Paged too: a truncated set sends already-analysed media to be billed again.
    const existing = await selectAllRows<{ storage_path: string; analysis_status: string | null; updated_at: string | null }>((from, to) =>
      supabase
        .from("media_analysis")
        .select("storage_path, analysis_status, updated_at")
        .eq("user_id", user.id)
        .order("id")
        .range(from, to)
    );

    // Only a finished analysis, or one still plausibly running, counts as done.
    // analyze-media runs in the background; when the runtime kills a long PDF
    // run its catch never fires and the rows stay "processing" for good, and
    // a failed run stays "failed". Counting those as analysed meant neither was
    // ever retried and scan mode reported them as done.
    const STALE_PROCESSING_MS = 15 * 60_000;
    const settled = (e: { analysis_status: string | null; updated_at: string | null }) =>
      e.analysis_status === "complete" ||
      (e.analysis_status === "processing" && !!e.updated_at &&
        Date.now() - new Date(e.updated_at).getTime() < STALE_PROCESSING_MS);
    const existingPaths = new Set((existing || []).filter(settled).map((e: any) => e.storage_path));
    const unanalyzed = allMedia.filter((m) => !existingPaths.has(m.path));

    const imageCount = unanalyzed.filter((m) => m.type === "image").length;
    const pdfCount = unanalyzed.filter((m) => m.type === "pdf").length;

    // Scan mode: just return counts
    if (mode === "scan") {
      return json({
        ok: true,
        total_media: allMedia.length,
        already_analyzed: allMedia.length - unanalyzed.length,
        unanalyzed_images: imageCount,
        unanalyzed_pdfs: pdfCount,
        unanalyzed_total: unanalyzed.length,
      });
    }

    // Run mode: process in batches
    let processed = 0;
    let failed = 0;
    const total = unanalyzed.length;

    // Call analyze-media for each item
    const analyzeUrl = `${SUPABASE_URL}/functions/v1/analyze-media`;

    for (let i = 0; i < unanalyzed.length; i += batchSize) {
      const batch = unanalyzed.slice(i, i + batchSize);

      const results = await Promise.allSettled(
        batch.map(async (item) => {
          const resp = await fetch(analyzeUrl, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              note_id: item.noteId,
              storage_path: item.path,
              media_type: item.type,
              original_filename: item.path.split("/").pop() || null,
            }),
          });

          if (!resp.ok) {
            const errText = await resp.text().catch(() => "");
            throw new Error(`analyze-media failed: ${resp.status} ${errText}`);
          }

          return await resp.json();
        })
      );

      for (const r of results) {
        if (r.status === "fulfilled") processed++;
        else failed++;
      }

      // Delay between batches (except last)
      if (i + batchSize < unanalyzed.length) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    return json({
      ok: true,
      total,
      processed,
      failed,
      message: `Analyzed ${processed} of ${total} media items${failed > 0 ? `, ${failed} failed` : ""}`,
    });
  } catch (err: any) {
    console.error("backfill-media-analysis error:", err);
    return json({ error: err.message }, 500);
  }
});
