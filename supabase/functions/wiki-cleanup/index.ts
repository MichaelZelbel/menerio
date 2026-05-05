import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;

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
    const mode: "dry_run" | "delete" = body.mode === "delete" ? "delete" : "dry_run";
    const explicitIds: string[] | null = Array.isArray(body.page_ids) ? body.page_ids : null;

    // Load all pages with linkage info.
    const { data: pages, error: pagesError } = await db
      .from("wiki_pages")
      .select("id, slug, title, page_type, content, source_count, updated_at")
      .eq("user_id", userId);
    if (pagesError) throw pagesError;

    const pageList = pages || [];
    if (pageList.length === 0) {
      return jsonResponse({ ok: true, mode, candidates: [], deleted: 0 });
    }

    const { data: links, error: linksError } = await db
      .from("wiki_links")
      .select("source_page_id, target_page_id")
      .eq("user_id", userId);
    if (linksError) throw linksError;

    const inboundCounts = new Map<string, number>();
    for (const link of links || []) {
      if (link.target_page_id) {
        inboundCounts.set(link.target_page_id, (inboundCounts.get(link.target_page_id) || 0) + 1);
      }
    }

    const candidates: CleanupCandidate[] = [];
    for (const page of pageList) {
      // Never auto-clean group pages — they're managed by the groups feature.
      if (page.page_type === "group") continue;

      const inbound = inboundCounts.get(page.id) || 0;
      const sourceCount = page.source_count || 0;
      const contentLen = (page.content || "").trim().length;

      let reason: string | null = null;
      if (sourceCount === 0 && inbound === 0) {
        reason = "no_sources_no_backlinks";
      } else if (contentLen < 60) {
        reason = "near_empty_content";
      } else if (sourceCount === 0 && contentLen < 200) {
        reason = "no_sources_thin_content";
      }
      if (reason) {
        candidates.push({
          id: page.id,
          slug: page.slug,
          title: page.title,
          page_type: page.page_type,
          source_count: sourceCount,
          inbound_links: inbound,
          reason,
          updated_at: page.updated_at,
        });
      }
    }

    let deleted = 0;
    if (mode === "delete") {
      const idsToDelete = explicitIds && explicitIds.length > 0
        ? candidates.filter((c) => explicitIds.includes(c.id)).map((c) => c.id)
        : candidates.map((c) => c.id);

      if (idsToDelete.length > 0) {
        // Delete dependent rows first (FKs use SET NULL on revisions/links).
        await db.from("wiki_links").delete().in("source_page_id", idsToDelete);
        await db.from("wiki_links").delete().in("target_page_id", idsToDelete);
        await db.from("wiki_page_sources").delete().in("wiki_page_id", idsToDelete);
        const { error: delError, count } = await db
          .from("wiki_pages")
          .delete({ count: "exact" })
          .in("id", idsToDelete)
          .eq("user_id", userId);
        if (delError) throw delError;
        deleted = count || idsToDelete.length;
      }

      await db.from("wiki_log").insert({
        user_id: userId,
        operation: "cleanup",
        details: { mode, candidate_count: candidates.length, deleted, explicit: !!explicitIds },
      });
    } else {
      await db.from("wiki_log").insert({
        user_id: userId,
        operation: "cleanup_preview",
        details: { mode, candidate_count: candidates.length },
      });
    }

    return jsonResponse({ ok: true, mode, candidates, deleted });
  } catch (error) {
    console.error("wiki-cleanup failed", error);
    return jsonResponse({ error: error instanceof Error ? error.message : "Cleanup failed" }, 500);
  }
});
