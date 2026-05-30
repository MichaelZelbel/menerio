import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;
const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY")!;
const OPENROUTER_MODEL = "openai/gpt-4o-mini";

type CleanupCandidate = {
  id: string;
  slug: string;
  title: string;
  page_type: string;
  source_count: number;
  inbound_links: number;
  reason: string;
  updated_at: string;
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function bearer(req: Request) {
  const header = req.headers.get("Authorization") || "";
  return header.startsWith("Bearer ") ? header.slice(7) : null;
}

function slugToWords(slug: string) {
  return slug.replace(/-/g, " ").trim();
}

function tiptapJsonToText(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const cur = node as { type?: string; text?: string; content?: unknown[]; attrs?: Record<string, unknown> };
  if (cur.type === "text") return cur.text || "";
  if (cur.type === "hardBreak") return "\n";
  const children = Array.isArray(cur.content) ? cur.content.map(tiptapJsonToText).join("") : "";
  if (["paragraph", "heading", "blockquote", "listItem", "taskItem"].includes(cur.type || "")) return `${children}\n`;
  return children;
}

function noteContentToText(content: unknown): string {
  if (typeof content !== "string") return "";
  const t = content.trim();
  if (!t) return "";
  if (t.startsWith("{") || t.startsWith("[")) {
    try { return tiptapJsonToText(JSON.parse(t)).replace(/\n{3,}/g, "\n\n").trim(); } catch { return t; }
  }
  return t.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

async function callLLM(system: string, user: string): Promise<string> {
  if (!OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY missing");
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENROUTER_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      temperature: 0.1,
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) throw new Error(`LLM ${res.status}: ${await res.text().catch(() => "")}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content || "";
}

const REBUILD_PROMPT = `You are rebuilding ONE Lexicon page strictly from the user's source notes provided below. Every claim and every wikilink MUST be directly supported by those notes. Do not invent facts. Do not pull in world knowledge. Do not add background context.

Rules:
- Start with one short summary paragraph.
- Use 2-4 short sections with ## headings such as "## Known facts", "## Open questions", "## Related".
- Use [[slug]] wikilinks ONLY for things explicitly named in the source notes. Maximum 5 links total.
- If the sources are thin, write a short page. It is fine to say "Limited information available."
- Never write integrations, relationships, or roles unless the notes spell them out.

Return ONLY JSON: {"title": "...", "summary": "one-line summary", "content": "full markdown of the page"}`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const token = bearer(req);
    if (!token) return jsonResponse({ error: "Unauthenticated" }, 401);

    const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { data: userData, error: userError } = await authClient.auth.getUser(token);
    if (userError || !userData.user) return jsonResponse({ error: "Unauthenticated" }, 401);
    const userId = userData.user.id;

    const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const body = await req.json().catch(() => ({}));
    const mode: string = body.mode || "dry_run";

    // ========== STRIP DEAD LINKS (bulk) ==========
    if (mode === "strip_dead_links") {
      const { data: pages, error: pErr } = await db
        .from("wiki_pages").select("id, slug, content").eq("user_id", userId);
      if (pErr) throw pErr;

      const slugSet = new Set((pages || []).map((p: any) => p.slug));
      let pagesChanged = 0;
      let linksRemoved = 0;
      const dryRun = body.dry_run === true;

      for (const page of pages || []) {
        const original = page.content || "";
        let next = original;
        const matches = [...original.matchAll(/\[\[([a-z0-9-]+)\]\]/g)];
        const dead = matches.filter((m) => !slugSet.has(m[1]));
        if (dead.length === 0) continue;
        for (const m of dead) {
          const slug = m[1];
          const re = new RegExp(`\\[\\[${slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\]\\]`, "g");
          next = next.replace(re, slugToWords(slug));
        }
        linksRemoved += dead.length;
        pagesChanged += 1;
        if (!dryRun) {
          const { error: uErr } = await db.from("wiki_pages").update({ content: next }).eq("id", page.id).eq("user_id", userId);
          if (uErr) throw uErr;
          await db.rpc("wiki_resync_links", { p_page_id: page.id });
        }
      }

      await db.from("wiki_log").insert({
        user_id: userId,
        operation: dryRun ? "strip_dead_links_preview" : "strip_dead_links",
        details: { pages_changed: pagesChanged, links_removed: linksRemoved },
      });

      return jsonResponse({ ok: true, mode, dry_run: dryRun, pages_changed: pagesChanged, links_removed: linksRemoved });
    }

    // ========== REBUILD ONE PAGE FROM SOURCES ==========
    if (mode === "rebuild_page") {
      const pageId: string = body.page_id;
      if (!pageId) return jsonResponse({ error: "page_id required" }, 400);

      const { data: page, error: pErr } = await db
        .from("wiki_pages").select("*").eq("id", pageId).eq("user_id", userId).maybeSingle();
      if (pErr) throw pErr;
      if (!page) return jsonResponse({ error: "page not found" }, 404);

      const { data: sources, error: sErr } = await db
        .from("wiki_page_sources")
        .select("note_id, notes:note_id(id, title, content, ai_visibility)")
        .eq("wiki_page_id", pageId).eq("user_id", userId);
      if (sErr) throw sErr;

      const noteBlocks = (sources || [])
        .map((s: any) => (s.notes && s.notes.ai_visibility !== "hidden") ? `### ${s.notes.title || "Untitled"}\n${noteContentToText(s.notes.content).slice(0, 4000)}` : "")
        .filter(Boolean).join("\n\n---\n\n");

      if (!noteBlocks) {
        return jsonResponse({ ok: false, error: "Page has no source notes to rebuild from." }, 400);
      }

      const userMsg = `Page slug: ${page.slug}\nPage type: ${page.page_type}\nCurrent title: ${page.title}\n\nSource notes:\n\n${noteBlocks}`;
      const raw = await callLLM(REBUILD_PROMPT, userMsg);
      let parsed: { title?: string; summary?: string; content?: string };
      try {
        const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
        parsed = JSON.parse(cleaned);
      } catch (e) {
        return jsonResponse({ ok: false, error: "LLM returned invalid JSON", raw }, 500);
      }

      if (!parsed.content || !parsed.content.trim()) {
        return jsonResponse({ ok: false, error: "LLM produced empty content" }, 500);
      }

      const newTitle = parsed.title?.trim() || page.title;
      const newSummary = parsed.summary?.trim() || page.summary;

      await db.from("wiki_revisions").insert({
        user_id: userId,
        wiki_page_id: pageId,
        page_slug: page.slug,
        page_title: newTitle,
        change_type: "manual_edit",
        previous_content: page.content,
        new_content: parsed.content,
        change_summary: "Rebuilt from source notes",
        status: "applied",
      });

      const { error: uErr } = await db.from("wiki_pages").update({
        title: newTitle,
        summary: newSummary,
        content: parsed.content,
        last_synthesized_at: new Date().toISOString(),
      }).eq("id", pageId).eq("user_id", userId);
      if (uErr) throw uErr;
      await db.rpc("wiki_resync_links", { p_page_id: pageId });

      await db.from("wiki_log").insert({
        user_id: userId, operation: "rebuild_page",
        details: { page_id: pageId, slug: page.slug, source_count: sources?.length || 0 },
      });

      return jsonResponse({ ok: true, mode, page_id: pageId });
    }

    // ========== EXISTING: dry_run / delete (low-quality candidates) ==========
    const explicitIds: string[] | null = Array.isArray(body.page_ids) ? body.page_ids : null;

    const { data: pages, error: pagesError } = await db
      .from("wiki_pages")
      .select("id, slug, title, page_type, content, source_count, updated_at")
      .eq("user_id", userId);
    if (pagesError) throw pagesError;

    const pageList = pages || [];
    if (pageList.length === 0) return jsonResponse({ ok: true, mode, candidates: [], deleted: 0 });

    const { data: links, error: linksError } = await db
      .from("wiki_links").select("source_page_id, target_page_id").eq("user_id", userId);
    if (linksError) throw linksError;

    const inboundCounts = new Map<string, number>();
    for (const link of links || []) {
      if (link.target_page_id) inboundCounts.set(link.target_page_id, (inboundCounts.get(link.target_page_id) || 0) + 1);
    }

    const candidates: CleanupCandidate[] = [];
    for (const page of pageList) {
      if (page.page_type === "group") continue;
      const inbound = inboundCounts.get(page.id) || 0;
      const sourceCount = page.source_count || 0;
      const contentLen = (page.content || "").trim().length;
      let reason: string | null = null;
      if (sourceCount === 0 && inbound === 0) reason = "no_sources_no_backlinks";
      else if (contentLen < 60) reason = "near_empty_content";
      else if (sourceCount === 0 && contentLen < 200) reason = "no_sources_thin_content";
      if (reason) candidates.push({
        id: page.id, slug: page.slug, title: page.title, page_type: page.page_type,
        source_count: sourceCount, inbound_links: inbound, reason, updated_at: page.updated_at,
      });
    }

    let deleted = 0;
    if (mode === "delete") {
      const idsToDelete = explicitIds && explicitIds.length > 0
        ? candidates.filter((c) => explicitIds.includes(c.id)).map((c) => c.id)
        : candidates.map((c) => c.id);
      if (idsToDelete.length > 0) {
        await db.from("wiki_links").delete().in("source_page_id", idsToDelete);
        await db.from("wiki_links").delete().in("target_page_id", idsToDelete);
        await db.from("wiki_page_sources").delete().in("wiki_page_id", idsToDelete);
        const { error: delError, count } = await db
          .from("wiki_pages").delete({ count: "exact" }).in("id", idsToDelete).eq("user_id", userId);
        if (delError) throw delError;
        deleted = count || idsToDelete.length;
      }
      await db.from("wiki_log").insert({
        user_id: userId, operation: "cleanup",
        details: { mode, candidate_count: candidates.length, deleted, explicit: !!explicitIds },
      });
    } else {
      await db.from("wiki_log").insert({
        user_id: userId, operation: "cleanup_preview",
        details: { mode, candidate_count: candidates.length },
      });
    }

    return jsonResponse({ ok: true, mode, candidates, deleted });
  } catch (error) {
    console.error("wiki-cleanup failed", error);
    return jsonResponse({ error: error instanceof Error ? error.message : "Cleanup failed" }, 500);
  }
});
