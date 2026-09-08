import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isValidCronRequest } from "../_shared/cron-auth.ts";
import { runGithubSync } from "../_shared/github-sync-run.ts";
import { selectAllRows } from "../_shared/paged-select.ts";
const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-key", "Content-Type": "application/json" };
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authorization = req.headers.get("Authorization") || "";
    const scheduler = (Boolean(serviceKey) && authorization === `Bearer ${serviceKey}`) || await isValidCronRequest(req);
    let userId: string | null = null;
    if (!scheduler) {
      if (!authorization.startsWith("Bearer ")) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers });
      const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authorization } } });
      const { data, error } = await userClient.auth.getClaims(authorization.slice(7));
      if (error || !data?.claims?.sub) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers });
      userId = data.claims.sub as string;
    }
    const client = createClient(url, serviceKey);
    const connections = await selectAllRows<any>((from, to) => {
      let query = client.from("github_connections").select("*").eq("sync_enabled", true).in("sync_direction", ["bidirectional", "import", "export"]).order("id").range(from, to);
      if (userId) query = query.eq("user_id", userId);
      return query;
    });
    const results = [];
    for (const connection of connections) {
      const result = await runGithubSync(client, connection.user_id, connection);
      results.push({ connection_id: connection.id, ...result });
    }
    const success = results.every(result => result.success);
    return new Response(JSON.stringify({ success, results }), { status: success ? 200 : 502, headers });
  } catch {
    return new Response(JSON.stringify({ success: false, error: "Scheduled synchronization failed" }), { status: 502, headers });
  }
});
