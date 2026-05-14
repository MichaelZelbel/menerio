import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const serviceClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsErr } = await userClient.auth.getClaims(token);
    if (claimsErr || !claimsData?.claims) return jsonResponse({ error: "Unauthorized" }, 401);
    const userId = claimsData.claims.sub;

    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "");

    // Helper to fetch the user's stored connection (server-side only)
    const getConn = async () => {
      const { data } = await serviceClient
        .from("github_connections")
        .select("github_token, repo_owner, repo_name, branch")
        .eq("user_id", userId)
        .maybeSingle();
      return data as { github_token: string; repo_owner: string | null; repo_name: string | null; branch: string } | null;
    };

    if (action === "test_connection") {
      // Accept either an inline token (during initial setup) or use the stored one
      const inlineToken: string | undefined = body.token;
      const owner: string | undefined = body.repo_owner;
      const repo: string | undefined = body.repo_name;

      let ghToken = inlineToken;
      let ghOwner = owner;
      let ghRepo = repo;
      if (!ghToken || !ghOwner || !ghRepo) {
        const conn = await getConn();
        ghToken = ghToken || conn?.github_token;
        ghOwner = ghOwner || conn?.repo_owner || undefined;
        ghRepo = ghRepo || conn?.repo_name || undefined;
      }
      if (!ghToken || !ghOwner || !ghRepo) {
        return jsonResponse({ error: "Token and repository required" }, 400);
      }

      const res = await fetch(`https://api.github.com/repos/${ghOwner}/${ghRepo}`, {
        headers: { Authorization: `token ${ghToken}`, Accept: "application/vnd.github.v3+json" },
      });
      if (res.ok) return jsonResponse({ status: "success" });
      if (res.status === 404) return jsonResponse({ status: "missing" });
      return jsonResponse({ status: "error", code: res.status, message: res.statusText }, 200);
    }

    if (action === "validate_token") {
      const inlineToken: string | undefined = body.token;
      if (!inlineToken) return jsonResponse({ error: "token required" }, 400);
      const res = await fetch("https://api.github.com/user", {
        headers: { Authorization: `token ${inlineToken}`, Accept: "application/vnd.github.v3+json" },
      });
      if (!res.ok) return jsonResponse({ error: "Invalid token" }, 400);
      const data = await res.json();
      return jsonResponse({ login: data.login });
    }

    if (action === "version_history") {
      const noteId: string | undefined = body.note_id;
      if (!noteId) return jsonResponse({ error: "note_id required" }, 400);

      const { data: syncLog } = await serviceClient
        .from("github_sync_log")
        .select("github_path")
        .eq("user_id", userId)
        .eq("note_id", noteId)
        .maybeSingle();
      if (!syncLog?.github_path) return jsonResponse({ commits: [] });

      const conn = await getConn();
      if (!conn?.github_token || !conn.repo_owner || !conn.repo_name) {
        return jsonResponse({ commits: [] });
      }

      const res = await fetch(
        `https://api.github.com/repos/${conn.repo_owner}/${conn.repo_name}/commits?path=${encodeURIComponent(syncLog.github_path)}&sha=${conn.branch}&per_page=30`,
        { headers: { Authorization: `token ${conn.github_token}`, Accept: "application/vnd.github.v3+json" } },
      );
      if (!res.ok) return jsonResponse({ commits: [] });
      const commits = await res.json();
      return jsonResponse({ commits });
    }

    if (action === "file_at_commit") {
      const path: string | undefined = body.path;
      const commitSha: string | undefined = body.commit_sha;
      if (!path || !commitSha) return jsonResponse({ error: "path and commit_sha required" }, 400);

      const conn = await getConn();
      if (!conn?.github_token || !conn.repo_owner || !conn.repo_name) {
        return jsonResponse({ error: "No GitHub connection" }, 400);
      }

      const res = await fetch(
        `https://api.github.com/repos/${conn.repo_owner}/${conn.repo_name}/contents/${encodeURIComponent(path)}?ref=${commitSha}`,
        { headers: { Authorization: `token ${conn.github_token}`, Accept: "application/vnd.github.v3+json" } },
      );
      if (!res.ok) return jsonResponse({ error: "Failed to fetch file" }, 502);
      const data = await res.json();
      // Decode base64 content server-side
      const decoded = new TextDecoder().decode(
        Uint8Array.from(atob((data.content || "").replace(/\n/g, "")), (c) => c.charCodeAt(0)),
      );
      return jsonResponse({ content: decoded });
    }

    return jsonResponse({ error: "Unknown action" }, 400);
  } catch (err) {
    console.error("github-proxy error", err);
    return jsonResponse({ error: "Internal error" }, 500);
  }
});
