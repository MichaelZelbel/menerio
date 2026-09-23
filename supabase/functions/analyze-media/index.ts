import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createNoteAIJobs } from "../_shared/note-ai-jobs.ts";
import {
  checkBalance,
  getEmbeddingWithCredits,
} from "../_shared/llm-credits.ts";
import { parseModelJson, runChat, runOcr } from "../_shared/llm-router.ts";
import { countPdfPages } from "../_shared/pdf-page-count.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY")!;

// Code-default models (used as fallback when DB config is disabled/missing).
const OCR_MODEL = "mistral-ocr-latest";
const VISION_MODEL = "pixtral-12b-2409";
const TEXT_MODEL = "mistral-small-latest";

/**
 * Most pages of one PDF sent to OCR. Each page is billed by the OCR provider and
 * then costs a summary call, up to three image descriptions and an embedding.
 * Pages past the cap are not analysed, and the result says so.
 */
const MAX_PDF_OCR_PAGES = 50;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const IMAGE_DESCRIBE_PROMPT = `Analyze this image. Return JSON:
- "description": 2-3 sentence description of what is shown (content, layout, notable visual elements).
- "topics": array of 1-5 short topic tags.
- "content_type": one of "screenshot", "photo", "diagram", "chart", "whiteboard", "document", "handwriting", "ui_mockup", "code", "other".
Only describe what's actually visible.`;

const PAGE_SUMMARY_PROMPT = `You are summarizing a single page of a document. Given the page's extracted markdown text (and any image descriptions), return JSON:
- "description": 2-3 sentence summary of what this page is about.
- "topics": array of 1-5 short topic tags.
- "content_type": one of "document", "slide", "form", "invoice", "report", "article", "diagram", "other".
Be specific and concise. Do not invent content.`;

function mimeFromExt(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() || "";
  const map: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    svg: "image/svg+xml",
    pdf: "application/pdf",
  };
  return map[ext] || "application/octet-stream";
}

async function downloadFile(storagePath: string): Promise<Uint8Array> {
  const { data, error } = await supabase.storage
    .from("note-attachments")
    .download(storagePath);
  if (error || !data) {
    throw new Error(`Failed to download file: ${error?.message || "no data"}`);
  }
  return new Uint8Array(await data.arrayBuffer());
}

async function fileToBase64DataUrl(
  storagePath: string,
  mimeType: string
): Promise<string> {
  return bytesToDataUrl(await downloadFile(storagePath), mimeType);
}

function bytesToDataUrl(buf: Uint8Array, mimeType: string): string {
  // chunk to avoid stack overflow on large files
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < buf.length; i += CHUNK) {
    binary += String.fromCharCode(...buf.subarray(i, i + CHUNK));
  }
  return `data:${mimeType};base64,${btoa(binary)}`;
}

interface PageSummary {
  description: string;
  topics: string[];
  content_type?: string;
}

const IMAGE_DESCRIBE_DEFAULT_PROMPT = IMAGE_DESCRIBE_PROMPT;
const PAGE_SUMMARY_DEFAULT_PROMPT = PAGE_SUMMARY_PROMPT;

async function summarizePageText(
  userId: string,
  pageText: string,
  imageDescriptions: string[]
): Promise<PageSummary> {
  const combined = [
    pageText,
    imageDescriptions.length
      ? `\n\nEmbedded images on this page:\n- ${imageDescriptions.join("\n- ")}`
      : "",
  ].join("");
  if (combined.trim().length === 0) {
    return { description: "", topics: [], content_type: "other" };
  }
  try {
    const result = await runChat({
      db: supabase,
      userId,
      callSite: "analyze-media.text",
      messages: [{ role: "user", content: combined.slice(0, 12000) }],
      defaults: {
        provider: "mistral",
        model: TEXT_MODEL,
        systemPrompt: PAGE_SUMMARY_DEFAULT_PROMPT,
      },
      callOptions: { response_format: { type: "json_object" } },
    });
    const parsed = parseModelJson<Record<string, unknown>>(result.content) ?? {};
    return {
      description: String(parsed.description || ""),
      topics: Array.isArray(parsed.topics) ? parsed.topics.map(String) : [],
      content_type: String(parsed.content_type || "other"),
    };
  } catch (e) {
    console.warn("summarizePageText failed:", (e as Error).message);
    return { description: "", topics: [], content_type: "other" };
  }
}

async function describeImage(
  userId: string,
  dataUrl: string,
  _feature: string
): Promise<PageSummary> {
  try {
    const result = await runChat({
      db: supabase,
      userId,
      callSite: "analyze-media.vision",
      messages: [
        {
          role: "user",
          // Mistral/OpenAI-compatible multimodal: content array
          content: [{ type: "image_url", image_url: dataUrl }] as unknown as string,
        },
      ],
      defaults: {
        provider: "mistral",
        model: VISION_MODEL,
        systemPrompt: IMAGE_DESCRIBE_DEFAULT_PROMPT,
      },
      callOptions: { response_format: { type: "json_object" } },
    });
    const parsed = parseModelJson<Record<string, unknown>>(result.content) ?? {};
    return {
      description: String(parsed.description || ""),
      topics: Array.isArray(parsed.topics) ? parsed.topics.map(String) : [],
      content_type: String(parsed.content_type || "other"),
    };
  } catch (e) {
    console.warn(`describeImage failed:`, (e as Error).message);
    return { description: "", topics: [], content_type: "other" };
  }
}

async function writeAnalysisRecord(p: {
  userId: string;
  noteId: string;
  storagePath: string;
  mediaType: string;
  pageNumber: number | null;
  originalFilename: string | null;
  extractedText: string;
  description: string;
  topics: string[];
  raw: Record<string, unknown>;
}) {
  // Generate embedding
  const embeddingText = `${p.description} ${p.extractedText}`.trim();
  let embedding: number[] | null = null;
  if (embeddingText.length > 0) {
    try {
      const embResult = await getEmbeddingWithCredits(
        supabase,
        OPENROUTER_API_KEY,
        p.userId,
        "analyze-media",
        embeddingText.slice(0, 8000)
      );
      embedding = embResult.embedding;
    } catch (e) {
      console.warn("Embedding failed:", (e as Error).message);
    }
  }

  // Upsert by (user_id, note_id, storage_path, page_number) — backed by the
  // media_analysis_unique_page unique index. Use .eq/.is properly so that
  // page_number = 1 vs NULL are never confused.
  let existingId: string | null = null;
  {
    let q = supabase
      .from("media_analysis")
      .select("id")
      .eq("user_id", p.userId)
      .eq("note_id", p.noteId)
      .eq("storage_path", p.storagePath);
    q = p.pageNumber === null ? q.is("page_number", null) : q.eq("page_number", p.pageNumber);
    const { data: existing } = await q.maybeSingle();
    existingId = existing?.id ?? null;
  }

  const payload = {
    user_id: p.userId,
    note_id: p.noteId,
    storage_path: p.storagePath,
    media_type: p.mediaType,
    page_number: p.pageNumber,
    original_filename: p.originalFilename,
    extracted_text: p.extractedText,
    description: p.description,
    topics: p.topics,
    raw_analysis: p.raw,
    embedding,
    analysis_status: "complete",
    error_message: null,
    updated_at: new Date().toISOString(),
  };

  if (existingId) {
    const { error } = await supabase.from("media_analysis").update(payload).eq("id", existingId);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabase.from("media_analysis").insert(payload);
    if (error) throw new Error(error.message);
  }
}

async function processImage(
  userId: string,
  noteId: string,
  storagePath: string,
  originalFilename: string | null
) {
  const mimeType = mimeFromExt(storagePath);
  const dataUrl = await fileToBase64DataUrl(storagePath, mimeType);

  // OCR
  const ocrResult = await runOcr({
    db: supabase,
    userId,
    callSite: "analyze-media.ocr",
    noteId,
    document: { type: "image_url", image_url: dataUrl },
    defaults: { model: OCR_MODEL },
  });
  const ocrResp = ocrResult.raw;
  const ocrPages = ocrResult.pages;
  const extractedText = ocrPages.map((p: any) => p.markdown || "").join("\n").trim();

  // Vision description
  const summary = await describeImage(userId, dataUrl, "analyze-media:vision");

  await writeAnalysisRecord({
    userId,
    noteId,
    storagePath,
    mediaType: "image",
    pageNumber: null,
    originalFilename,
    extractedText,
    description: summary.description,
    topics: summary.topics,
    raw: { ocr: ocrResp, ...summary },
  });
}

async function processPdf(
  userId: string,
  noteId: string,
  storagePath: string,
  originalFilename: string | null
) {
  const bytes = await downloadFile(storagePath);
  const dataUrl = bytesToDataUrl(bytes, "application/pdf");

  // OCR bills per page, and every page then costs a summary call, up to three
  // image descriptions and an embedding. Without a cap one long upload (a
  // 600-page manual) was billed in full. Ask the provider for the first
  // MAX_PDF_OCR_PAGES pages only, and say so on the result.
  const pageCount = await countPdfPages(bytes);
  const capRange = { pages: `0-${MAX_PDF_OCR_PAGES - 1}` };
  const runPdfOcr = async (extra: Record<string, unknown>) => {
    return await runOcr({
      db: supabase,
      userId,
      callSite: "analyze-media.ocr",
      noteId,
      document: { type: "document_url", document_url: dataUrl },
      extra: { include_image_base64: true, ...extra },
      defaults: { model: OCR_MODEL },
    });
  };
  // Always a range, even for a "short" document: the count is read from the
  // file itself (the first uncompressed /Count), so a hybrid or crafted PDF
  // claiming one page was OCR'd, and billed, in full. Sized to the stated count
  // so an honest short document never asks for pages it lacks; capped when the
  // count is unreadable. If the provider refuses the range because the document
  // is shorter than it, the document is short, so asking again without a range
  // cannot run up a long bill.
  const range = pageCount !== null
    ? { pages: `0-${Math.max(1, Math.min(pageCount, MAX_PDF_OCR_PAGES)) - 1}` }
    : capRange;
  let ocrResult;
  try {
    ocrResult = await runPdfOcr(range);
  } catch (err) {
    const message = (err as Error).message || "";
    if (!/\((400|422)\)/.test(message) || !/page/i.test(message)) throw err;
    ocrResult = await runPdfOcr({});
  }
  const ocrResp = ocrResult.raw;
  const pages = ocrResult.pages.slice(0, MAX_PDF_OCR_PAGES);
  const truncated = pageCount !== null
    ? pageCount > MAX_PDF_OCR_PAGES
    : ocrResult.pages.length >= MAX_PDF_OCR_PAGES;
  const truncationNote = truncated
    ? pageCount !== null
      ? `Only the first ${MAX_PDF_OCR_PAGES} of ${pageCount} pages were analysed (page limit per PDF).`
      : `Only the first ${MAX_PDF_OCR_PAGES} pages were analysed (page limit per PDF); the document may have more.`
    : "";
  if (truncated) console.warn(`analyze-media: PDF page cap applied note=${noteId} path=${storagePath} pages=${pageCount ?? "unknown"}`);

  if (pages.length === 0) {
    throw new Error("OCR returned no pages");
  }

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const pageNumber = (page.index ?? i) + 1;
    const pageText: string = page.markdown || "";

    // Describe up to 3 embedded images per page (cost control)
    const imageDescriptions: string[] = [];
    const rawImages: any[] = [];
    const pageImages = Array.isArray(page.images) ? page.images.slice(0, 3) : [];
    for (const img of pageImages) {
      const b64 = img.image_base64 || img.base64;
      if (!b64) continue;
      const url = b64.startsWith("data:") ? b64 : `data:image/png;base64,${b64}`;
      const desc = await describeImage(userId, url, "analyze-media:pdf-image");
      if (desc.description) {
        imageDescriptions.push(desc.description);
        rawImages.push({ id: img.id, ...desc });
      }
    }

    // Page-level summary
    const summary = await summarizePageText(userId, pageText, imageDescriptions);
    const combinedDescription = [
      summary.description,
      imageDescriptions.length
        ? `Images: ${imageDescriptions.join(" ")}`
        : "",
      // The last analysed page carries the cap notice, where the user reads it.
      i === pages.length - 1 ? truncationNote : "",
    ]
      .filter(Boolean)
      .join(" ")
      .trim();

    await writeAnalysisRecord({
      userId,
      noteId,
      storagePath,
      mediaType: "pdf",
      pageNumber,
      originalFilename,
      extractedText: pageText,
      description: combinedDescription,
      topics: summary.topics,
      raw: {
        ocr_model: ocrResp.model,
        page_index: page.index,
        images: rawImages,
        summary,
        page_cap: MAX_PDF_OCR_PAGES,
        pages_total: pageCount,
        truncated,
      },
    });
  }
}

async function processMedia(
  noteId: string,
  storagePath: string,
  mediaType: string,
  originalFilename: string | null,
  userId: string
) {
  const jobStartedAt = new Date().toISOString();

  // Mark all existing rows for this (note, path) as 'processing' in-place so
  // the UI keeps a single, stable item to display. New page results from this
  // run will overwrite by (note, path, page_number).
  const { data: existingRows, error: selectErr } = await supabase
    .from("media_analysis")
    .select("id, page_number")
    .eq("note_id", noteId)
    .eq("storage_path", storagePath);

  if (selectErr) {
    console.warn("Failed to read existing analysis rows:", selectErr.message);
  }

  const existingPageNumbers = new Set<number | null>(
    (existingRows || []).map((r: any) => r.page_number),
  );

  if (existingRows && existingRows.length > 0) {
    await supabase
      .from("media_analysis")
      .update({
        analysis_status: "processing",
        error_message: null,
        updated_at: jobStartedAt,
      })
      .eq("note_id", noteId)
      .eq("storage_path", storagePath);
  } else {
    // First run: insert a single placeholder row so the UI sees the job.
    await supabase.from("media_analysis").insert({
      user_id: userId,
      note_id: noteId,
      storage_path: storagePath,
      media_type: mediaType,
      page_number: null,
      original_filename: originalFilename,
      analysis_status: "processing",
    });
    existingPageNumbers.add(null);
  }

  try {
    const balance = await checkBalance(supabase, userId);
    if (!balance.allowed) {
      await supabase
        .from("media_analysis")
        .update({
          analysis_status: "failed",
          error_message: "Insufficient AI credits",
          updated_at: new Date().toISOString(),
        })
        .eq("note_id", noteId)
        .eq("storage_path", storagePath);
      return;
    }

    if (mediaType === "pdf") {
      await processPdf(userId, noteId, storagePath, originalFilename);
    } else {
      await processImage(userId, noteId, storagePath, originalFilename);
    }

    // Remove leftover 'processing' rows from before this run that were not
    // overwritten (e.g. a previous run with a page_number=null placeholder, or
    // page count shrank). Anything still 'processing' for this path is stale.
    await supabase
      .from("media_analysis")
      .delete()
      .eq("note_id", noteId)
      .eq("storage_path", storagePath)
      .eq("analysis_status", "processing");

    console.log(
      `analyze-media complete via Mistral (${mediaType}) note=${noteId} path=${storagePath}`
    );

    // Media completion already queued transactionally; reconcile without provider dispatch.
    await createNoteAIJobs(supabase).enqueue(userId, noteId, "analysis", "automatic");
  } catch (err) {
    console.error("analyze-media error:", err);
    await supabase
      .from("media_analysis")
      .update({
        analysis_status: "failed",
        error_message: (err as Error).message || "Unknown error",
        updated_at: new Date().toISOString(),
      })
      .eq("note_id", noteId)
      .eq("storage_path", storagePath)
      .eq("analysis_status", "processing");
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
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    // gdrive-sync hands imports over with the service key, which getUser()
    // refuses, so every Drive import skipped OCR with a 401. A service call
    // acts for the owner of the note it names; a user call acts for the user.
    const isService = !!SUPABASE_SERVICE_ROLE_KEY && token === SUPABASE_SERVICE_ROLE_KEY;

    const body = await req.json();
    const { note_id, storage_path, media_type, original_filename } = body;

    let user: { id: string } | null = null;
    if (isService) {
      if (typeof note_id !== "string" || !note_id) {
        return new Response(JSON.stringify({ error: "note_id required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data: noteRow, error: noteErr } = await supabase
        .from("notes").select("user_id").eq("id", note_id).maybeSingle();
      if (noteErr) throw noteErr;
      if (!noteRow) {
        return new Response(JSON.stringify({ error: "Note not found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      user = { id: (noteRow as { user_id: string }).user_id };
    } else {
      const { data: { user: authed }, error: authErr } = await supabase.auth.getUser(token);
      if (authErr || !authed) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      user = authed;
    }

    if (!note_id || !storage_path || !media_type) {
      return new Response(
        JSON.stringify({
          error: "note_id, storage_path, and media_type are required",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // The note-attachments bucket is partitioned by owner id (`${userId}/<uuid>`),
    // and processMedia downloads, upserts, and deletes media_analysis rows keyed
    // only on storage_path/note_id with no user filter. Without this check a
    // caller could pass another user's storage_path to read that user's file and
    // clobber their analysis rows. Confining the path to the caller's own prefix
    // closes that cross-user access.
    if (typeof storage_path !== "string" || !storage_path.startsWith(`${user.id}/`)) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // @ts-expect-error EdgeRuntime is a Supabase global not in TS scope
    EdgeRuntime.waitUntil(
      processMedia(
        note_id,
        storage_path,
        media_type,
        original_filename ?? null,
        user.id
      )
    );

    return new Response(JSON.stringify({ ok: true, processing: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("analyze-media handler error:", err);
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
