import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ensureGithubRepository, githubDeleteFile, githubGetFile } from "../_shared/github-api.ts";
import {
  GhCtx,
  resolveEntityConflict,
  sweepPeopleExport,
} from "../_shared/people-sync-core.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsErr } = await userClient.auth.getClaims(token);
    if (claimsErr || !claimsData?.claims) return json({ error: "Unauthorized" }, 401);
    const userId = claimsData.claims.sub as string;

    const body = await req.json().catch(() => ({}));

    const { data: ghConn } = await serviceClient
      .from("github_connections")
      .select("*")
      .eq("user_id", userId)
      .single();

    if (!ghConn) return json({ error: "No GitHub connection found" }, 400);
    if (!ghConn.sync_enabled) return json({ error: "Sync is disabled" }, 400);
    if (!ghConn.repo_owner || !ghConn.repo_name) return json({ error: "Repository not configured" }, 400);

    const gh: GhCtx = {
      token: ghConn.github_token,
      owner: ghConn.repo_owner,
      repo: ghConn.repo_name,
      branch: ghConn.branch || "main",
      vaultPath: ghConn.vault_path || "/",
    };

    // ── Action: get-conflicts ──
    if (body.action === "get-conflicts") {
      const { data: rows } = await serviceClient
        .from("github_sync_log")
        .select("id, entity_type, entity_id, github_path, error_message, synced_at")
        .eq("user_id", userId)
        .in("entity_type", ["person", "group"])
        .eq("sync_status", "conflict");

      const conflicts = rows || [];
      const personIds = conflicts.filter((r: any) => r.entity_type === "person").map((r: any) => r.entity_id);
      const groupIds = conflicts.filter((r: any) => r.entity_type === "group").map((r: any) => r.entity_id);
      const [contactsRes, groupsRes] = await Promise.all([
        personIds.length
          ? serviceClient.from("contacts").select("id, name").in("id", personIds)
          : Promise.resolve({ data: [] }),
        groupIds.length
          ? serviceClient.from("contact_groups").select("id, name").in("id", groupIds)
          : Promise.resolve({ data: [] }),
      ]);
      const names = new Map<string, string>();
      for (const c of (contactsRes as any).data || []) names.set(c.id, c.name);
      for (const g of (groupsRes as any).data || []) names.set(g.id, g.name);

      return json({
        conflicts: conflicts.map((r: any) => ({ ...r, name: names.get(r.entity_id) || r.github_path })),
      });
    }

    // ── Action: resolve-conflict ──
    if (body.action === "resolve-conflict") {
      const { entity_type, entity_id, resolution } = body;
      if (!["person", "group"].includes(entity_type) || !entity_id) {
        return json({ error: "entity_type and entity_id required" }, 400);
      }
      if (resolution === "keep_both") {
        return json({ error: "keep_both is not supported for people/groups — it would create a duplicate entity. Use keep_local or keep_remote." }, 400);
      }
      if (!["keep_local", "keep_remote"].includes(resolution)) {
        return json({ error: "resolution must be keep_local or keep_remote" }, 400);
      }
      const result = await resolveEntityConflict(serviceClient, userId, gh, entity_type, entity_id, resolution);
      if (!result.ok) return json({ error: result.error }, 400);
      return json({ success: true, resolution });
    }

    // ── Action: delete (single entity's mirrored file; called BEFORE the DB
    // delete so the sync-log path is still available). Returns the group ids
    // whose member tables will need a refresh once the DB delete lands. ──
    if (body.action === "delete") {
      const { entity_type, entity_id } = body;
      if (!["person", "group"].includes(entity_type) || !entity_id) {
        return json({ error: "entity_type and entity_id required" }, 400);
      }
      const { data: row } = await serviceClient
        .from("github_sync_log")
        .select("*")
        .eq("user_id", userId)
        .eq("entity_type", entity_type)
        .eq("entity_id", entity_id)
        .maybeSingle();

      let affectedGroupIds: string[] = [];
      if (entity_type === "person") {
        const { data: memberships } = await serviceClient
          .from("contact_group_memberships")
          .select("group_id")
          .eq("user_id", userId)
          .eq("contact_id", entity_id)
          .is("archived_at", null);
        affectedGroupIds = [...new Set((memberships || []).map((m: any) => m.group_id))];
      }

      if (row) {
        const file = await githubGetFile(gh.token, gh.owner, gh.repo, row.github_path, gh.branch);
        if (file?.sha) {
          await githubDeleteFile(gh.token, gh.owner, gh.repo, row.github_path, file.sha, `Remove: ${row.github_path}`, gh.branch);
        }
        await serviceClient.from("github_sync_log").delete().eq("id", row.id);
      }
      return json({ success: true, affected_group_ids: affectedGroupIds });
    }

    // ── Default: sweep (or bulk backfill) ──
    if (ghConn.sync_people === false) return json({ error: "People sync is disabled" }, 400);
    if (!["export", "bidirectional"].includes(ghConn.sync_direction || "export")) {
      return json({ success: true, skipped: "sync_direction does not allow export" });
    }

    const repoState = await ensureGithubRepository(gh.token, gh.owner, gh.repo, gh.branch);
    const result = await sweepPeopleExport(serviceClient, userId, gh, {
      bulk: !!body.bulk,
      forcePeople: Array.isArray(body.force_people) ? body.force_people : [],
      forceGroups: Array.isArray(body.force_groups) ? body.force_groups : [],
    });

    return json({ success: result.errors === 0, repository_created: repoState.created, ...result });
  } catch (err) {
    console.error("github-people-sync error:", err);
    return json({ error: String(err) }, 500);
  }
});
