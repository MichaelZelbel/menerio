import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authenticateHubKey, requireScope } from "../_shared/hub-auth.ts";
import { checkRateLimit } from "../_shared/hub-rate-limit.ts";
import {
  json,
  errorJson,
  handleOptions,
  intParam,
  parsePath,
} from "../_shared/hub-helpers.ts";
import { selectAllRows } from "../_shared/paged-select.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return handleOptions();

  const { result: auth, error: authErr } = await authenticateHubKey(req);
  if (authErr) return authErr;
  const scopeErr = requireScope(auth!.scopes, "stats");
  if (scopeErr) return scopeErr;

  const rl = await checkRateLimit(auth!.keyId);
  if (!rl.allowed) return rl.error!;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const userId = auth!.userId;
  const url = new URL(req.url);
  const parts = parsePath(url);
  const action = parts[1] || "";

  try {
    // GET /hub-api-stats/overview
    if (req.method === "GET" && action === "overview") {
      const [noteRes, contactRes, actionRes, recentNotesRes] = await Promise.all([
        supabase
          .from("notes")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId)
          .eq("is_trashed", false),
        supabase
          .from("contacts")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId),
        supabase
          .from("action_items")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId)
          .eq("status", "open"),
        supabase
          .from("notes")
          .select("tags")
          .eq("user_id", userId)
          .eq("is_trashed", false)
          .not("tags", "eq", "{}")
          .order("updated_at", { ascending: false })
          .limit(200),
      ]);

      // Compute top tags
      const tagCounts: Record<string, number> = {};
      for (const note of recentNotesRes.data || []) {
        for (const tag of (note.tags || [])) {
          tagCounts[tag] = (tagCounts[tag] || 0) + 1;
        }
      }
      const topTags = Object.entries(tagCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([tag, count]) => ({ tag, count }));

      return json({
        data: {
          note_count: noteRes.count || 0,
          contact_count: contactRes.count || 0,
          open_action_count: actionRes.count || 0,
          top_tags: topTags,
        },
      });
    }

    // GET /hub-api-stats/activity?days=30
    if (req.method === "GET" && action === "activity") {
      const days = intParam(url, "days", 30, 1, 365);
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

      // Every event in the window, not the first 1,000: with `.limit(1000)` a
      // busy month stopped counting partway through, the later days read as
      // quiet, and total_events reported 1000 as if that were the real number.
      let events: Array<{ created_at: string }>;
      try {
        events = await selectAllRows<{ created_at: string }>((from, to) =>
          supabase
            .from("activity_events")
            .select("created_at")
            .eq("actor_id", userId)
            .gte("created_at", since)
            .order("created_at", { ascending: true })
            .order("id", { ascending: true })
            .range(from, to)
        );
      } catch (error) {
        return errorJson("INTERNAL", (error as { message?: string }).message ?? String(error), 500);
      }

      // Group by day
      const dailyCounts: Record<string, number> = {};
      for (const event of events || []) {
        const day = event.created_at.split("T")[0];
        dailyCounts[day] = (dailyCounts[day] || 0) + 1;
      }

      const activity = Object.entries(dailyCounts)
        .map(([date, count]) => ({ date, count }))
        .sort((a, b) => a.date.localeCompare(b.date));

      return json({
        data: { days, activity, total_events: events?.length || 0 },
      });
    }

    return errorJson("NOT_FOUND", "Endpoint not found. Use /overview or /activity", 404);
  } catch (err) {
    return errorJson("INTERNAL", (err as Error).message, 500);
  }
});
