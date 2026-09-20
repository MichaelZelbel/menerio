/**
 * The monthly AI allowance, created on demand.
 *
 * Until 2026-09-20 the only thing that ever created a month's allowance row was
 * the web app, from `useAICredits` at sign-in. An account whose owner never
 * opened the app that month had no row, `checkBalance` read "zero rows" as "no
 * credits", and every server-side caller quietly fell back: notes captured by an
 * assistant over MCP were stored without an embedding, the hub mirror was stored
 * without one, and search answered by words only. That is exactly the account of
 * someone who lets an assistant keep the notebook, which is what the MCP server
 * is for. Found with a free test account that had been idle since July: 27
 * mirrored files, `mode: "text_only"`, and an allowance row that appeared the
 * moment the app's own function was called by hand.
 *
 * The row is the same one the app would have created: same period, same role
 * lookup, same rollover, same race-safe upsert. `db` must be a service-role
 * client, because the table is not writable by its owner.
 */
// deno-lint-ignore no-explicit-any
type Db = any;

export function allowancePeriodDates(now: Date = new Date()) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { period_start: start.toISOString(), period_end: end.toISOString() };
}

async function creditSettings(db: Db): Promise<Record<string, number>> {
  const { data, error } = await db.from("ai_credit_settings").select("key, value_int");
  if (error) throw error;
  const map: Record<string, number> = {};
  for (const row of data || []) map[row.key] = row.value_int;
  return map;
}

export async function ensureAllowanceForUser(db: Db, userId: string, now: Date = new Date()) {
  const { period_start, period_end } = allowancePeriodDates(now);
  const nowIso = now.toISOString();

  const { data: existing } = await db
    .from("ai_allowance_periods")
    .select("*")
    .eq("user_id", userId)
    .gte("period_end", nowIso)
    .lte("period_start", nowIso)
    .maybeSingle();
  if (existing) return existing;

  const { data: roleData } = await db.rpc("get_user_role", { _user_id: userId });
  const role = roleData || "free";

  const settings = await creditSettings(db);
  const tokensPerCredit = settings["tokens_per_credit"] || 200;
  const creditsPerMonth = role === "premium" || role === "premium_gift" || role === "admin"
    ? settings["credits_premium_per_month"] || 1500
    : settings["credits_free_per_month"] || 0;
  const baseTokens = creditsPerMonth * tokensPerCredit;

  // Previous period rollover (unused tokens, capped at baseTokens).
  // `lte`, not `lt`: last month's period ENDS at the instant this one starts, so a strict
  // comparison skipped exactly the month it was written for and only ever found a period
  // from two or more months back. The test account showed it: idle since July, it rolled
  // July over into September, which the strict version can do, and would never have
  // rolled August into September.
  let rolloverTokens = 0;
  const { data: prevPeriod } = await db
    .from("ai_allowance_periods")
    .select("tokens_granted, tokens_used")
    .eq("user_id", userId)
    .lte("period_end", period_start)
    .order("period_end", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (prevPeriod) {
    const unused = Math.max(0, prevPeriod.tokens_granted - prevPeriod.tokens_used);
    rolloverTokens = Math.min(unused, baseTokens);
  }

  // Race-safe insert: relies on the unique index (user_id, period_start, period_end).
  // If a concurrent caller just inserted a row, ignoreDuplicates returns no rows
  // and we re-select the existing one.
  const { data: inserted, error: insertErr } = await db
    .from("ai_allowance_periods")
    .upsert(
      {
        user_id: userId,
        tokens_granted: baseTokens + rolloverTokens,
        tokens_used: 0,
        period_start,
        period_end,
        source: role === "free" ? "free_tier" : "role_based",
        metadata: {
          base_tokens: baseTokens,
          rollover_tokens: rolloverTokens,
          credits_per_month: creditsPerMonth,
          tokens_per_credit: tokensPerCredit,
          role,
        },
      },
      { onConflict: "user_id,period_start,period_end", ignoreDuplicates: true },
    )
    .select()
    .maybeSingle();
  if (insertErr) throw insertErr;
  if (inserted) return inserted;

  const { data: winner, error: reselectErr } = await db
    .from("ai_allowance_periods")
    .select("*")
    .eq("user_id", userId)
    .eq("period_start", period_start)
    .eq("period_end", period_end)
    .maybeSingle();
  if (reselectErr) throw reselectErr;
  return winner;
}
