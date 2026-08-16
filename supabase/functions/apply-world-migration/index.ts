import { authenticateHubKey } from "../_shared/hub-auth.ts";
import { json, errorJson, handleOptions } from "../_shared/hub-helpers.ts";
import postgres from "https://esm.sh/postgres@3.4.4";

/**
 * ONE SHOT. Applies the World migration, and nothing else, then gets deleted.
 *
 * Why it exists: applying a schema change needs a credential the hub does not
 * hold. Supabase gives every edge function a direct database URL, which is the
 * project's own documented way in, so the migration runs from inside the project
 * rather than from outside it.
 *
 * It takes no SQL from the caller. It reads the migration file sitting next to
 * this one, which is a byte copy of
 * supabase/migrations/20260816120000_9a3f61c2-4d70-4c88-9b21-7e0a5c1d3f84.sql.
 * So this endpoint can do exactly one thing and cannot be turned into a way to
 * run anything else. It still requires a hub API key.
 *
 * The migration is written to be safe to run twice.
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return handleOptions();
  if (req.method !== "POST") {
    return errorJson("METHOD", "POST to run the migration.", 405);
  }

  const { result: auth, error: authErr } = await authenticateHubKey(req);
  if (authErr) return authErr;
  if (!auth) return errorJson("FORBIDDEN", "No key.", 403);

  const dbUrl = Deno.env.get("SUPABASE_DB_URL");
  if (!dbUrl) {
    return errorJson("NO_DB_URL", "SUPABASE_DB_URL is not set for this function.", 500);
  }

  let migration: string;
  try {
    migration = await Deno.readTextFile(new URL("./migration.sql", import.meta.url));
  } catch (err) {
    return errorJson("NO_SQL_FILE", `Could not read migration.sql: ${(err as Error).message}`, 500);
  }

  const client = postgres(dbUrl, { max: 1, prepare: false });
  try {
    await client.unsafe(migration);

    const views = await client`
      select table_name from information_schema.views
      where table_schema = 'public'
        and table_name in ('world_entities', 'world_events', 'world_claims')
      order by table_name`;

    const rankColumns = await client`
      select table_name from information_schema.columns
      where table_schema = 'public' and column_name = 'rank'
        and table_name in ('profile_entries', 'contact_relationships')
      order by table_name`;

    const triggers = await client`
      select trigger_name from information_schema.triggers
      where trigger_schema = 'public' and trigger_name like 'trg_%preferred%'
      order by trigger_name`;

    const marked = await client`
      select count(*)::int as n from profile_entries where rank = 'preferred'`;

    const counts = await client`
      select
        (select count(*)::int from world_entities) as entities,
        (select count(*)::int from world_events) as events,
        (select count(*)::int from world_claims) as claims`;

    return json({
      data: {
        applied: true,
        views: views.map((r: Record<string, string>) => r.table_name),
        rank_columns: rankColumns.map((r: Record<string, string>) => r.table_name),
        triggers: triggers.map((r: Record<string, string>) => r.trigger_name),
        profile_entries_marked_preferred: marked[0]?.n ?? 0,
        rows_visible_through_the_views: counts[0] ?? null,
      },
    });
  } catch (err) {
    return errorJson("MIGRATION_FAILED", (err as Error).message, 500);
  } finally {
    await client.end({ timeout: 5 });
  }
});
