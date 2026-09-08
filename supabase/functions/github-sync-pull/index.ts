import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { runGithubSync } from "../_shared/github-sync-run.ts";

const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Content-Type": "application/json" };
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers });
  try {
    const authorization = req.headers.get("Authorization");
    if (!authorization?.startsWith("Bearer ")) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers });
    const url = Deno.env.get("SUPABASE_URL")!;
    const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authorization } } });
    const { data, error } = await userClient.auth.getClaims(authorization.slice(7));
    if (error || !data?.claims?.sub) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers });
    const userId = data.claims.sub as string;
    const client = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const connection = await client.from("github_connections").select("*").eq("user_id", userId).single();
    if (connection.error) throw connection.error;
    if (!connection.data?.repo_owner || !connection.data.repo_name) return new Response(JSON.stringify({ error: "No GitHub connection configured" }), { status: 400, headers });
    const body = await req.json().catch(() => ({}));
    const result = await runGithubSync(client, userId, connection.data, body);
    return new Response(JSON.stringify(result), { status: result.success ? 200 : result.busy ? 409 : 502, headers });
  } catch {
    return new Response(JSON.stringify({ success: false, error: "GitHub synchronization failed" }), { status: 502, headers });
  }
});
