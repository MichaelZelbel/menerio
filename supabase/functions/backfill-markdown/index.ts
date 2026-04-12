import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

/** Returns true when content looks like HTML (has block-level tags) */
function looksLikeHtml(content: string): boolean {
  return /<(?:p|h[1-6]|ul|ol|li|blockquote|pre|img|table)\b/i.test(content);
}

/** Convert HTML to Markdown (server-side, no DOM) */
function htmlToMarkdown(html: string): string {
  if (!html || !html.trim()) return "";
  let md = html;
  md = md.replace(/<br\s*\/?>/gi, "  \n");
  md = md.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, (_, c) => `# ${strip(c)}\n\n`);
  md = md.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (_, c) => `## ${strip(c)}\n\n`);
  md = md.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, (_, c) => `### ${strip(c)}\n\n`);
  md = md.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, (_, c) => `#### ${strip(c)}\n\n`);
  md = md.replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, (_, c) => `##### ${strip(c)}\n\n`);
  md = md.replace(/<h6[^>]*>([\s\S]*?)<\/h6>/gi, (_, c) => `###### ${strip(c)}\n\n`);
  md = md.replace(/<hr\s*\/?>/gi, "\n---\n\n");
  md = md.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, c) => {
    const inner = htmlToMarkdown(c).trim();
    return inner.split("\n").map((l: string) => `> ${l}`).join("\n") + "\n\n";
  });
  md = md.replace(/<pre[^>]*><code(?:\s+class="language-(\w+)")?[^>]*>([\s\S]*?)<\/code><\/pre>/gi, (_, lang, code) =>
    `\`\`\`${lang || ""}\n${decode(code).trimEnd()}\n\`\`\`\n\n`
  );
  md = md.replace(/<ul[^>]*data-type="taskList"[^>]*>([\s\S]*?)<\/ul>/gi, (_, items) =>
    items.replace(/<li[^>]*data-checked="(true|false)"[^>]*>([\s\S]*?)<\/li>/gi, (_m: string, checked: string, text: string) =>
      `- ${checked === "true" ? "[x]" : "[ ]"} ${strip(text).trim()}\n`
    ) + "\n"
  );
  md = md.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, (_, items) =>
    items.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_m: string, text: string) => `- ${strip(text).trim()}\n`) + "\n"
  );
  md = md.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (_, items) => {
    let idx = 0;
    return items.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_m: string, text: string) => {
      idx++;
      return `${idx}. ${strip(text).trim()}\n`;
    }) + "\n";
  });
  md = md.replace(/<img[^>]*src="([^"]*)"[^>]*alt="([^"]*)"[^>]*\/?>/gi, (_, src, alt) => `![${alt}](${src})`);
  md = md.replace(/<img[^>]*src="([^"]*)"[^>]*\/?>/gi, (_, src) => `![](${src})`);
  md = md.replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href, text) => `[${strip(text)}](${href})`);
  md = md.replace(/<(?:strong|b)>([\s\S]*?)<\/(?:strong|b)>/gi, (_, c) => `**${c}**`);
  md = md.replace(/<(?:em|i)>([\s\S]*?)<\/(?:em|i)>/gi, (_, c) => `*${c}*`);
  md = md.replace(/<(?:del|s|strike)>([\s\S]*?)<\/(?:del|s|strike)>/gi, (_, c) => `~~${c}~~`);
  md = md.replace(/<code>([\s\S]*?)<\/code>/gi, (_, c) => `\`${decode(c)}\``);
  md = md.replace(/<mark[^>]*>([\s\S]*?)<\/mark>/gi, (_, c) => `==${c}==`);
  md = md.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (_, c) => `${strip(c)}\n\n`);
  md = md.replace(/<[^>]+>/g, "");
  md = decode(md);
  md = md.replace(/\n{3,}/g, "\n\n");
  return md.trim() + "\n";
}

function strip(html: string): string {
  return html.replace(/<\/?(?:p|div|label|span)[^>]*>/gi, "").trim();
}

function decode(text: string): string {
  return text.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsErr } = await userClient.auth.getClaims(token);
    if (claimsErr || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }
    const userId = claimsData.claims.sub as string;

    // Optional: limit to a specific user or require admin
    const body = await req.json().catch(() => ({}));
    const batchSize = body.batch_size || 100;
    const offset = body.offset || 0;

    // Fetch notes with HTML content
    const { data: notes, error: fetchErr } = await serviceClient
      .from("notes")
      .select("id, content")
      .eq("user_id", userId)
      .range(offset, offset + batchSize - 1);

    if (fetchErr) {
      return new Response(JSON.stringify({ error: fetchErr.message }), { status: 500, headers: corsHeaders });
    }

    let converted = 0;
    let skipped = 0;
    let errors = 0;

    for (const note of notes || []) {
      if (!note.content || !looksLikeHtml(note.content)) {
        skipped++;
        continue;
      }

      try {
        const markdown = htmlToMarkdown(note.content);
        await serviceClient
          .from("notes")
          .update({ content: markdown })
          .eq("id", note.id);
        converted++;
      } catch (err) {
        console.error(`Failed to convert note ${note.id}:`, err);
        errors++;
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        total: (notes || []).length,
        converted,
        skipped,
        errors,
        next_offset: offset + batchSize,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("backfill-markdown error:", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: corsHeaders });
  }
});
