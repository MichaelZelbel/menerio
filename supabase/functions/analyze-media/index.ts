import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  checkBalance,
  chatWithCredits,
  getEmbeddingWithCredits,
} from "../_shared/llm-credits.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const VISION_PROMPT = `Analyze this image thoroughly. Return JSON with:
- "extracted_text": all readable text in the image, preserving layout and structure as much as possible. Include text from labels, headings, captions, UI elements, handwriting, and any other visible text. If no text is visible, return an empty string.
- "description": 2-3 sentence description of what the image shows. Be specific about the content, layout, and any notable visual elements. Mention colors, diagrams, charts, UI components, people, objects, or scenes as relevant.
- "topics": array of 1-5 short topic tags relevant to the image content.
- "content_type": one of "screenshot", "photo", "diagram", "chart", "whiteboard", "document", "handwriting", "ui_mockup", "code", "other"
Only extract what's actually visible. Don't invent or infer details that aren't in the image.`;

async function processMedia(
  noteId: string,
  storagePath: string,
  mediaType: string,
  pageNumber: number | null,
  originalFilename: string | null,
  userId: string
) {
  // Create a pending record
  const { data: record, error: insertErr } = await supabase
    .from("media_analysis")
    .insert({
      user_id: userId,
      note_id: noteId,
      storage_path: storagePath,
      media_type: mediaType,
      page_number: pageNumber,
      original_filename: originalFilename,
      analysis_status: "processing",
    })
    .select("id")
    .single();

  if (insertErr) {
    console.error("Failed to insert media_analysis record:", insertErr);
    return;
  }

  const recordId = record.id;

  try {
    // Check credits
    const balance = await checkBalance(supabase, userId);
    if (!balance.allowed) {
      await supabase
        .from("media_analysis")
        .update({
          analysis_status: "failed",
          error_message: "Insufficient AI credits",
        })
        .eq("id", recordId);
      return;
    }

    // Download file from storage
    const { data: fileData, error: dlErr } = await supabase.storage
      .from("note-attachments")
      .download(storagePath);

    if (dlErr || !fileData) {
      throw new Error(`Failed to download file: ${dlErr?.message || "no data"}`);
    }

    // Convert to base64
    const arrayBuf = await fileData.arrayBuffer();
    const uint8 = new Uint8Array(arrayBuf);
    let binary = "";
    for (let i = 0; i < uint8.length; i++) {
      binary += String.fromCharCode(uint8[i]);
    }
    const base64 = btoa(binary);

    // Determine MIME type from file extension
    const ext = storagePath.split(".").pop()?.toLowerCase() || "";
    const mimeMap: Record<string, string> = {
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      gif: "image/gif",
      webp: "image/webp",
      svg: "image/svg+xml",
      pdf: "application/pdf",
    };
    const mimeType = mimeMap[ext] || "image/png";

    // Call vision LLM via OpenRouter directly (chatWithCredits doesn't support image content)
    const openrouterBalance = await checkBalance(supabase, userId);
    if (!openrouterBalance.allowed) {
      throw new Error("INSUFFICIENT_CREDITS");
    }

    const visionBody = {
      model: "openai/gpt-4o-mini",
      messages: [
        { role: "system", content: VISION_PROMPT },
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: {
                url: `data:${mimeType};base64,${base64}`,
              },
            },
          ],
        },
      ],
      response_format: { type: "json_object" },
    };

    const visionResp = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(visionBody),
      }
    );

    if (!visionResp.ok) {
      const errText = await visionResp.text().catch(() => "");
      throw new Error(`Vision LLM failed: ${visionResp.status} ${errText}`);
    }

    const visionResult = await visionResp.json();

    // Deduct tokens for the vision call
    const { deductTokens } = await import("../_shared/llm-credits.ts");
    const usage = visionResult.usage || {};
    const promptTokens = usage.prompt_tokens || 0;
    const completionTokens = usage.completion_tokens || 0;
    const totalTokens =
      usage.total_tokens || promptTokens + completionTokens || 1000;
    const usageSource = usage.total_tokens ? "provider" : "fallback";

    await deductTokens(supabase, {
      userId,
      tokens: totalTokens,
      feature: "analyze-media:vision",
      model: "openai/gpt-4o-mini",
      provider: "openrouter",
      promptTokens,
      completionTokens,
      usageSource,
    });

    // Parse the analysis result
    let analysis: Record<string, unknown>;
    try {
      analysis = JSON.parse(
        visionResult.choices[0].message.content
      );
    } catch {
      analysis = {
        extracted_text: "",
        description: "Unable to parse analysis",
        topics: [],
        content_type: "other",
      };
    }

    const extractedText = (analysis.extracted_text as string) || "";
    const description = (analysis.description as string) || "";
    const topics = Array.isArray(analysis.topics)
      ? (analysis.topics as string[])
      : [];

    // Generate embedding of combined text
    const embeddingText = `${description} ${extractedText}`.trim();
    let embedding: number[] | null = null;

    if (embeddingText.length > 0) {
      try {
        const embResult = await getEmbeddingWithCredits(
          supabase,
          OPENROUTER_API_KEY,
          userId,
          "analyze-media",
          embeddingText
        );
        embedding = embResult.embedding;
      } catch (e: any) {
        console.warn("Embedding generation failed:", e.message);
      }
    }

    // Update the record with results
    await supabase
      .from("media_analysis")
      .update({
        extracted_text: extractedText,
        description,
        topics,
        raw_analysis: analysis,
        embedding,
        analysis_status: "complete",
      })
      .eq("id", recordId);

    console.log(
      `analyze-media complete for note=${noteId}, path=${storagePath}, tokens=${totalTokens}`
    );
  } catch (err: any) {
    console.error("analyze-media error:", err);
    await supabase
      .from("media_analysis")
      .update({
        analysis_status: "failed",
        error_message: err.message || "Unknown error",
      })
      .eq("id", recordId);
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
    const { note_id, storage_path, media_type, page_number, original_filename } =
      body;

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

    // Process in background
    // @ts-ignore EdgeRuntime available in Supabase
    EdgeRuntime.waitUntil(
      processMedia(
        note_id,
        storage_path,
        media_type,
        page_number ?? null,
        original_filename ?? null,
        user.id
      )
    );

    return new Response(
      JSON.stringify({ ok: true, processing: true }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err: any) {
    console.error("analyze-media handler error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
