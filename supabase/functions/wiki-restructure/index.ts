import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveSystemPrompt } from "../_shared/llm-router.ts";
import { WIKI_RESTRUCTURE_PROMPT } from "../_shared/llm-defaults.ts";
import {
  analyzeStructure,
  chunkMarkdown,
  missingFacts,
  needsRestructure,
  softStructure,
} from "../_shared/wiki-structure.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY")!;
const OPENROUTER_MODEL = "google/gemini-2.5-flash";

// A page is only rewritten by the LLM when a deterministic pass can't make it readable.
const MAX_PAGES_PER_RUN = 200;

type PageRow = {
  id: string;
  user_id: string;
  slug: string;
  title: string;
  content: string;
  protected_sections: string[] | null;
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function extractBearer(req: Request): string | null {
  const header = req.headers.get("Authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1] || null;
}

async function logWiki(db: any, userId: string, operation: string, details: Record<string, unknown>) {
  const { error } = await db.from("wiki_log").insert({ user_id: userId, operation, details });
  if (error) console.error("wiki_log insert failed", error);
}

async function callReformat(systemPrompt: string, userContent: string): Promise<string> {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
      temperature: 0,
      response_format: { type: "json_object" },
    }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`OpenRouter failed: ${response.status} ${text}`);
  }
  const data = await response.json();
  const raw = data.choices?.[0]?.message?.content || "";
  const cleaned = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const parsed = JSON.parse(cleaned);
  return typeof parsed.content === "string" ? parsed.content : "";
}

/** Never touch sections the user has edited by hand: keep their bodies verbatim. */
function protectedSectionBodies(content: string, slugs: string[]): Map<string, string> {
  const map = new Map<string, string>();
  if (slugs.length === 0) return map;
  const sections = content.split(/\n(?=#{2,3}\s)/);
  for (const section of sections) {
    const heading = section.match(/^#{2,3}\s+(.+)$/m)?.[1] || "";
    const slug = heading.toLowerCase().replace(/[^a-z0-9\s-]/g, "").trim().replace(/\s+/g, "-");
    if (slug && slugs.includes(slug)) map.set(slug, section.trim());
  }
  return map;
}

function reattachProtected(content: string, protectedMap: Map<string, string>): string {
  if (protectedMap.size === 0) return content;
  let next = content;
  for (const [slug, body] of protectedMap) {
    const present = new RegExp(`^#{2,3}\\s+.*$`, "gm");
    const headings = next.match(present) || [];
    const found = headings.some((heading) =>
      heading.replace(/^#{2,3}\s+/, "").toLowerCase().replace(/[^a-z0-9\s-]/g, "").trim().replace(/\s+/g, "-") === slug
    );
    if (!found) next = `${next.trimEnd()}\n\n${body}\n`;
  }
  return next;
}

async function restructurePage(db: any, page: PageRow, systemPrompt: string, dryRun: boolean) {
  const original = page.content || "";
  const before = analyzeStructure(original);

  // 1) Deterministic repair first — always lossless.
  let next = softStructure(original);
  let method: "soft" | "llm" | "llm_rejected" = "soft";
  let rejectedReason: string | null = null;

  // 2) LLM reformat when the deterministic pass isn't enough (no headings, oversized sections).
  if (needsRestructure(next)) {
    // Smaller chunks keep the model in "reformat" mode instead of summarising.
    const chunks = chunkMarkdown(next, 3500);

    const attempt = async (strict: boolean) => {
      const rewritten: string[] = [];
      for (let index = 0; index < chunks.length; index += 1) {
        const label = chunks.length > 1
          ? `\n\n(This is part ${index + 1} of ${chunks.length} of the page "${page.title}". Do not add an intro sentence to parts after the first.)`
          : "";
        const strictNote = strict
          ? `\n\nSTRICT RETRY: your previous attempt dropped information. Keep EVERY name, number, date and wikilink exactly as written. Only add headings and split paragraphs — never summarise, merge or delete a fact.`
          : "";
        const out = await callReformat(
          systemPrompt,
          `Page title: ${page.title}\n\n---\n${chunks[index]}\n---${label}${strictNote}`,
        );
        if (!out.trim()) throw new Error("empty_llm_output");
        rewritten.push(out.trim());
      }
      return softStructure(rewritten.join("\n\n"));
    };

    try {
      let candidate = await attempt(false);
      let lost = missingFacts(next, candidate);
      if (lost.length > 0) {
        candidate = await attempt(true);
        lost = missingFacts(next, candidate);
      }
      if (lost.length > 0) {
        method = "llm_rejected";
        rejectedReason = `lost ${lost.length} tokens: ${lost.slice(0, 8).join(", ")}`;
      } else {
        next = candidate;
        method = "llm";
      }
    } catch (error) {
      method = "llm_rejected";
      rejectedReason = error instanceof Error ? error.message : String(error);
    }
  }


  next = reattachProtected(next, protectedSectionBodies(original, page.protected_sections || []));
  const after = analyzeStructure(next);
  const changed = next.trim() !== original.trim();

  if (!dryRun && changed) {
    const { error: revisionError } = await db.from("wiki_revisions").insert({
      user_id: page.user_id,
      wiki_page_id: page.id,
      page_slug: page.slug,
      page_title: page.title,
      change_type: "restructured",
      previous_content: original,
      new_content: next,
      change_summary: `Reformatted for readability (${method})`,
      source_note_id: null,
      status: "applied",
    });
    if (revisionError) throw revisionError;

    const { error: updateError } = await db
      .from("wiki_pages")
      .update({ content: next })
      .eq("id", page.id);
    if (updateError) throw updateError;
  }

  return {
    slug: page.slug,
    method,
    changed,
    rejected_reason: rejectedReason,
    before: { chars: before.chars, headings: before.headingCount, max_paragraph_words: before.maxParagraphWords, max_section_words: before.maxSectionWords },
    after: { chars: after.chars, headings: after.headingCount, max_paragraph_words: after.maxParagraphWords, max_section_words: after.maxSectionWords },
  };
}

async function runJob(db: any, actorId: string, pages: PageRow[], dryRun: boolean) {
  const startedAt = Date.now();
  const results: unknown[] = [];
  let failed = 0;
  const systemPrompt = await resolveSystemPrompt(db, "wiki-restructure.main", WIKI_RESTRUCTURE_PROMPT, {});

  for (const page of pages) {
    try {
      results.push(await restructurePage(db, page, systemPrompt, dryRun));
    } catch (error) {
      failed += 1;
      console.error("wiki-restructure page failed", page.slug, error);
      results.push({ slug: page.slug, method: "error", changed: false, rejected_reason: error instanceof Error ? error.message : String(error) });
    }
  }

  await logWiki(db, actorId, dryRun ? "restructure_dry_run" : "restructure", {
    total: pages.length,
    failed,
    duration_ms: Date.now() - startedAt,
    results: results.slice(0, 100),
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const token = extractBearer(req);
    const body = await req.json().catch(() => ({}));
    const dryRun = body.dry_run === true;
    const slugs: string[] = Array.isArray(body.slugs) ? body.slugs.filter((slug: unknown) => typeof slug === "string") : [];
    const force = body.force === true;

    // Narrow scheduled sweep (pg_cron): no user/slug targeting allowed, it can
    // only reformat pages that already fail the readability contract.
    const isCronSweep = body.cron === "wiki-restructure" && !body.user_id && slugs.length === 0 && !force;
    if (!token && !isCronSweep) return jsonResponse({ error: "Unauthenticated" }, 401);

    const isServiceCall = isCronSweep || token === SUPABASE_SERVICE_ROLE_KEY;
    let db: any;
    let actorId: string;

    if (isServiceCall) {
      db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      actorId = !isCronSweep && typeof body.user_id === "string" ? body.user_id : "";
    } else {
      const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
      const { data: userData, error: userError } = await authClient.auth.getUser(token!);
      if (userError || !userData.user) return jsonResponse({ error: "Unauthenticated" }, 401);
      actorId = userData.user.id;
      db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: `Bearer ${token}` } },
      });
    }

    const perRun = isCronSweep
      ? Math.min(Number(body.limit) || 25, 50)
      : MAX_PAGES_PER_RUN;

    let query = db
      .from("wiki_pages")
      .select("id, user_id, slug, title, content, protected_sections")
      .order("updated_at", { ascending: false })
      .limit(isCronSweep ? 500 : perRun);
    if (slugs.length > 0) query = query.in("slug", slugs);
    if (isServiceCall && actorId) query = query.eq("user_id", actorId);


    const { data, error } = await query;
    if (error) throw error;

    const candidates = ((data || []) as PageRow[])
      .filter((page) => force || slugs.length > 0 || needsRestructure(page.content || ""))
      .slice(0, perRun);


    if (candidates.length === 0) {
      return jsonResponse({ accepted: true, total: 0, message: "All Lexicon pages already pass the readability checks." });
    }

    if (dryRun) {
      const preview = candidates.map((page) => {
        const report = analyzeStructure(page.content || "");
        return {
          slug: page.slug,
          chars: report.chars,
          headings: report.headingCount,
          max_paragraph_words: report.maxParagraphWords,
          max_section_words: report.maxSectionWords,
        };
      });
      return jsonResponse({ accepted: true, dry_run: true, total: candidates.length, pages: preview });
    }

    // @ts-expect-error — EdgeRuntime is provided by Supabase Edge Runtime.
    EdgeRuntime.waitUntil(runJob(db, actorId || candidates[0].user_id, candidates, false));

    return jsonResponse({ accepted: true, total: candidates.length }, 202);
  } catch (error) {
    console.error("wiki-restructure failed", error);
    return jsonResponse({ error: "Lexicon restructure failed" }, 500);
  }
});
