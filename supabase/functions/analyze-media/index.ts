import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  checkBalance,
  deductTokens,
  getEmbeddingWithCredits,
} from "../_shared/llm-credits.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY")!;
const MISTRAL_API_KEY = Deno.env.get("MISTRAL_API_KEY")!;

const MISTRAL_OCR_URL = "https://api.mistral.ai/v1/ocr";
const MISTRAL_CHAT_URL = "https://api.mistral.ai/v1/chat/completions";
const OCR_MODEL = "mistral-ocr-latest";
const VISION_MODEL = "pixtral-12b-2409";
const TEXT_MODEL = "mistral-small-latest";

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

async function fileToBase64DataUrl(
  storagePath: string,
  mimeType: string
): Promise<string> {
  const { data, error } = await supabase.storage
    .from("note-attachments")
    .download(storagePath);
  if (error || !data) {
    throw new Error(`Failed to download file: ${error?.message || "no data"}`);
  }
  const buf = new Uint8Array(await data.arrayBuffer());
  // chunk to avoid stack overflow on large files
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < buf.length; i += CHUNK) {
    binary += String.fromCharCode(...buf.subarray(i, i + CHUNK));
  }
  return `data:${mimeType};base64,${btoa(binary)}`;
}

async function mistralFetch(url: string, body: unknown): Promise<any> {
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${MISTRAL_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Mistral ${url} failed: ${resp.status} ${text}`);
  }
  return await resp.json();
}

async function deductFromUsage(
  userId: string,
  feature: string,
  model: string,
  usage: any
) {
  const promptTokens = usage?.prompt_tokens ?? 0;
  const completionTokens = usage?.completion_tokens ?? 0;
  const totalTokens =
    usage?.total_tokens ?? (promptTokens + completionTokens || 1000);
  const usageSource = usage?.total_tokens ? "provider" : "fallback";
  try {
    await deductTokens(supabase, {
      userId,
      tokens: Math.max(1, totalTokens),
      feature,
      model,
      provider: "mistral",
      promptTokens,
      completionTokens,
      usageSource,
    });
  } catch (e) {
    console.warn(`deductTokens failed for ${feature}:`, (e as Error).message);
  }
}

interface PageSummary {
  description: string;
  topics: string[];
  content_type?: string;
}

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
    const result = await mistralFetch(MISTRAL_CHAT_URL, {
      model: TEXT_MODEL,
      messages: [
        { role: "system", content: PAGE_SUMMARY_PROMPT },
        { role: "user", content: combined.slice(0, 12000) },
      ],
      response_format: { type: "json_object" },
    });
    await deductFromUsage(userId, "analyze-media:summary", TEXT_MODEL, result.usage);
    const parsed = JSON.parse(result.choices[0].message.content);
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
  feature: string
): Promise<PageSummary> {
  try {
    const result = await mistralFetch(MISTRAL_CHAT_URL, {
      model: VISION_MODEL,
      messages: [
        { role: "system", content: IMAGE_DESCRIBE_PROMPT },
        {
          role: "user",
          content: [{ type: "image_url", image_url: dataUrl }],
        },
      ],
      response_format: { type: "json_object" },
    });
    await deductFromUsage(userId, feature, VISION_MODEL, result.usage);
    const parsed = JSON.parse(result.choices[0].message.content);
    return {
      description: String(parsed.description || ""),
      topics: Array.isArray(parsed.topics) ? parsed.topics.map(String) : [],
      content_type: String(parsed.content_type || "other"),
    };
  } catch (e) {
    console.warn(`describeImage (${feature}) failed:`, (e as Error).message);
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
    if (error) console.warn("media_analysis update failed:", error.message);
  } else {
    const { error } = await supabase.from("media_analysis").insert(payload);
    if (error) console.warn("media_analysis insert failed:", error.message);
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
  const ocrResp = await mistralFetch(MISTRAL_OCR_URL, {
    model: OCR_MODEL,
    document: { type: "image_url", image_url: dataUrl },
  });
  const ocrPages = ocrResp.pages || [];
  const extractedText = ocrPages.map((p: any) => p.markdown || "").join("\n").trim();
  const pagesProcessed = ocrResp.usage_info?.pages_processed || 1;
  await deductFromUsage(userId, "analyze-media:ocr", OCR_MODEL, {
    total_tokens: pagesProcessed * 500,
  });

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
  const dataUrl = await fileToBase64DataUrl(storagePath, "application/pdf");

  const ocrResp = await mistralFetch(MISTRAL_OCR_URL, {
    model: OCR_MODEL,
    document: { type: "document_url", document_url: dataUrl },
    include_image_base64: true,
  });
  const pages = ocrResp.pages || [];
  const pagesProcessed = ocrResp.usage_info?.pages_processed || pages.length;
  await deductFromUsage(userId, "analyze-media:ocr", OCR_MODEL, {
    total_tokens: Math.max(1, pagesProcessed) * 500,
  });

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
    const { note_id, storage_path, media_type, original_filename } = body;

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
