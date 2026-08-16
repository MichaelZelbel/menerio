import { authenticateHubKey } from "../_shared/hub-auth.ts";
import { json, errorJson, handleOptions } from "../_shared/hub-helpers.ts";
import { MIGRATION_B64 } from "./migration-sql.ts";

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

  // Carried as base64 in migration-sql.ts, which is generated from migration.sql
  // in the same folder. A plain static file next to the function is not bundled
  // at deploy time, and the SQL contains backticks, so it cannot be a template
  // literal either.
  const migration = new TextDecoder().decode(
    Uint8Array.from(atob(MIGRATION_B64), (c) => c.charCodeAt(0)),
  );

  // Imported here rather than at the top so a driver that fails to load returns
  // a readable message instead of a bare "Internal Server Error" from the
  // runtime, which is what a failed top-level import produces.
  let postgres: (url: string, opts?: Record<string, unknown>) => any;
  try {
    const mod = await import("https://deno.land/x/postgresjs@v3.4.4/mod.js");
    postgres = (mod.default ?? mod) as typeof postgres;
  } catch (err) {
    return errorJson("NO_DRIVER", `Could not load the postgres driver: ${(err as Error).message}`, 500);
  }

  const client = postgres(dbUrl, { max: 1, prepare: false });

  // POST /apply-world-migration/selftest proves the guard actually holds against
  // the real database, inside one transaction that is always rolled back, so it
  // leaves nothing behind. Asserting a trigger works without running it is the
  // failure this whole check exists to avoid.
  if (new URL(req.url).pathname.endsWith("/selftest")) {
    try {
      const observed: Record<string, unknown> = {};
      await client.begin(async (tx: any) => {
        const [cat] = await tx`
          select id from profile_categories where user_id = ${auth.userId} limit 1`;
        if (!cat) throw new Error("no profile category to test against");

        const [row] = await tx`
          insert into profile_entries (user_id, category_id, label, value, origin)
          values (${auth.userId}, ${cat.id}, 'world guard test', 'the human value', 'user_manual')
          returning id, value, rank`;
        observed.after_human_insert = { value: row.value, rank: row.rank };

        // The evidence quote is required by an older guard: an automated profile
        // fact must carry the words it came from. A real machine write has one,
        // so the test supplies one rather than dodging the rule.
        await tx`
          update profile_entries
          set value = 'a machine overwrote it', label = 'machine label',
              origin = 'ai_note',
              evidence_quote = 'a sentence a machine claims it read somewhere'
          where id = ${row.id}`;
        const [afterUpdate] = await tx`
          select value, label, rank, origin from profile_entries where id = ${row.id}`;
        observed.after_machine_update = afterUpdate;

        await tx`delete from profile_entries where id = ${row.id}`;
        const [{ n }] = await tx`
          select count(*)::int as n from profile_entries where id = ${row.id}`;
        observed.survived_machine_delete = n === 1;

        // Nothing above is kept. The test must not add a fact to anyone's life.
        throw new Error("ROLLBACK_ON_PURPOSE");
      }).catch((e: Error) => {
        if (e.message !== "ROLLBACK_ON_PURPOSE") throw e;
      });

      return json({ data: { selftest: true, observed } });
    } catch (err) {
      return errorJson("SELFTEST_FAILED", (err as Error).message, 500);
    } finally {
      await client.end({ timeout: 5 });
    }
  }

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
