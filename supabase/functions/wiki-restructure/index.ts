import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { runChat } from "../_shared/llm-router.ts";
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

// A page is only rewritten by the LLM when a deterministic pass can't make it readable.
const MAX_PAGES_PER_RUN = 200;

// A page that keeps failing must never be retried forever: after this many
// consecutive LLM failures the page is parked until its content changes.
const MAX_CONSECUTIVE_FAILURES = 3;
// Backoff for transient failures, indexed by attempt count.
const BACKOFF_HOURS = [1, 6, 24];
// Pages longer than this are not worth an LLM rewrite: the deterministic pass
// handles them and we never pay for output that gets thrown away.
const MAX_LLM_PAGE_CHARS = 24_000;
const CHUNK_CHARS = 3500;

type PageRow = {
  id: string;
  user_id: string;
  slug: string;
  title: string;
  content: string;
  protected_sections: string[] | null;
  restructure_attempts?: number | null;
  restructure_blocked_until?: string | null;
  restructure_content_hash?: string | null;
};

/** Raised when the provider is out of credit: abort the sweep, don't burn the rest. */
class SweepAbort extends Error {}

async function contentHash(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function isOutOfCredit(message: string): boolean {
  return /\b402\b/.test(message) || /requires more credits|insufficient/i.test(message);
}

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

/**
 * Parse the model's reply into markdown. Models routinely emit raw newlines
 * inside the JSON string, which makes `JSON.parse` throw ("Unterminated
 * string") even though the content is perfectly usable — we repair that
 * instead of discarding a call we already paid for.
 */
function parseReformatted(raw: string): string {
  const cleaned = (raw || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  if (!cleaned) return "";
  try {
    const parsed = JSON.parse(cleaned);
    if (typeof parsed?.content === "string") return parsed.content;
  } catch {
    // fall through to repair
  }
  const match = cleaned.match(/"content"\s*:\s*"([\s\S]*?)"\s*[,}]\s*$/)
    ?? cleaned.match(/"content"\s*:\s*"([\s\S]*)$/);
  if (match) {
    return match[1]
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, "\t")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\")
      .replace(/"\s*}?\s*$/, "");
  }
  // Not JSON at all — the model answered with plain markdown.
  if (!cleaned.startsWith("{")) return cleaned;
  return "";
}

async function callReformat(
  db: any,
  userId: string,
  userContent: string,
  maxTokens: number,
): Promise<string> {
  try {
    const result = await runChat({
      db,
      userId,
      callSite: "wiki-restructure.main",
      messages: [{ role: "user", content: userContent }],
      defaults: {
        provider: "openrouter",
        model: "deepseek/deepseek-v4-flash",
        systemPrompt: WIKI_RESTRUCTURE_PROMPT,
        temperature: 0,
      },
      // Ceiling sized from the input: without one OpenRouter reserves the model
      // maximum and 402s, with a fixed 8k we paid for truncated output.
      callOptions: { response_format: { type: "json_object" }, max_tokens: maxTokens },
    });
    return parseReformatted(result.content);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isOutOfCredit(message)) throw new SweepAbort(message);
    throw error;
  }
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

async function restructurePage(db: any, page: PageRow, dryRun: boolean) {
  const original = page.content || "";
  const before = analyzeStructure(original);

  // 1) Deterministic repair first — always lossless.
  let next = softStructure(original);
  let method: "soft" | "llm" | "llm_rejected" | "soft_only" = "soft";
  let rejectedReason: string | null = null;
  let llmFailed = false;

  // 2) LLM reformat when the deterministic pass isn't enough (no headings, oversized sections).
  if (needsRestructure(next)) {
    if (next.length > MAX_LLM_PAGE_CHARS) {
      // Too large to rewrite economically: keep the deterministic result and
      // stop qualifying, rather than paying for a rewrite every sweep.
      method = "soft_only";
      rejectedReason = `page too large for LLM restructure (${next.length} chars)`;
      llmFailed = true;
    } else {
      // Smaller chunks keep the model in "reformat" mode instead of summarising.
      const chunks = chunkMarkdown(next, CHUNK_CHARS);

      const attempt = async (strict: boolean) => {
        const rewritten: string[] = [];
        for (let index = 0; index < chunks.length; index += 1) {
          const label = chunks.length > 1
            ? `\n\n(This is part ${index + 1} of ${chunks.length} of the page "${page.title}". Do not add an intro sentence to parts after the first.)`
            : "";
          const strictNote = strict
            ? `\n\nSTRICT RETRY: your previous attempt dropped information. Keep EVERY name, number, date and wikilink exactly as written. Only add headings and split paragraphs — never summarise, merge or delete a fact.`
            : "";
          // Reformatting can only grow the text modestly; ~1 token per 3 chars
          // plus headroom is plenty and keeps the provider from reserving more.
          const maxTokens = Math.min(8000, Math.ceil(chunks[index].length / 3) + 900);
          const out = await callReformat(
            db,
            page.user_id,
            `Page title: ${page.title}\n\n---\n${chunks[index]}\n---${label}${strictNote}`,
            maxTokens,
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
          llmFailed = true;
        } else {
          next = candidate;
          method = "llm";
        }
      } catch (error) {
        if (error instanceof SweepAbort) throw error;
        method = "llm_rejected";
        rejectedReason = error instanceof Error ? error.message : String(error);
        llmFailed = true;
      }
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

  if (!dryRun) {
    // Bookkeeping: a page that failed must back off, and park permanently after
    // MAX_CONSECUTIVE_FAILURES until someone edits it (content hash changes).
    const finalContent = changed ? next : original;
    const hash = await contentHash(finalContent);
    if (llmFailed) {
      const attempts = (page.restructure_attempts ?? 0) + 1;
      const hours = BACKOFF_HOURS[Math.min(attempts, BACKOFF_HOURS.length) - 1];
      const blockedUntil = attempts >= MAX_CONSECUTIVE_FAILURES
        ? null // parked: gated by the hash instead of a timestamp
        : new Date(Date.now() + hours * 3_600_000).toISOString();
      await db.from("wiki_pages").update({
        restructure_attempts: attempts,
        restructure_last_error: rejectedReason,
        restructure_blocked_until: blockedUntil,
        restructure_content_hash: hash,
      }).eq("id", page.id);
    } else {
      await db.from("wiki_pages").update({
        restructure_attempts: 0,
        restructure_last_error: null,
        restructure_blocked_until: null,
        restructure_content_hash: hash,
      }).eq("id", page.id);
    }
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

/**
 * True when a page is allowed to consume an LLM call right now: it is not in
 * backoff and it hasn't already burned its attempts on this exact content.
 */
async function isRestructureAllowed(page: PageRow): Promise<boolean> {
  const attempts = page.restructure_attempts ?? 0;
  if (attempts === 0) return true;
  const hash = await contentHash(page.content || "");
  // Content changed since the last failure → fresh start.
  if (page.restructure_content_hash && page.restructure_content_hash !== hash) return true;
  if (attempts >= MAX_CONSECUTIVE_FAILURES) return false;
  if (page.restructure_blocked_until && new Date(page.restructure_blocked_until) > new Date()) return false;
  return true;
}

async function runJob(db: any, actorId: string, pages: PageRow[], dryRun: boolean) {
  const startedAt = Date.now();
  const results: unknown[] = [];
  let failed = 0;
  let aborted: string | null = null;
  const operation = dryRun ? "restructure_dry_run" : "restructure";

  for (const page of pages) {
    let result: unknown;
    try {
      result = await restructurePage(db, page, dryRun);
    } catch (error) {
      if (error instanceof SweepAbort) {
        // Provider out of credit — stop immediately instead of burning the
        // remaining pages on calls that can only fail.
        aborted = error.message;
        console.error("wiki-restructure sweep aborted (out of credit)", error.message);
        await db.from("wiki_pages").update({
          restructure_blocked_until: new Date(Date.now() + 6 * 3_600_000).toISOString(),
          restructure_last_error: "provider out of credit",
        }).in("id", pages.map((p) => p.id));
        break;
      }
      failed += 1;
      console.error("wiki-restructure page failed", page.slug, error);
      result = { slug: page.slug, method: "error", changed: false, rejected_reason: error instanceof Error ? error.message : String(error) };
    }
    results.push(result);
    // Log per page so progress survives a runtime shutdown mid-sweep.
    await logWiki(db, actorId, operation, { total: 1, failed: 0, page: page.slug, results: [result] });
  }

  await logWiki(db, actorId, operation, {
    total: pages.length,
    failed,
    aborted,
    summary: true,
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
