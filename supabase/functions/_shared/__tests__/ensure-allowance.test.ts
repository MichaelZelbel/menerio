import { describe, expect, it } from "vitest";
import { allowancePeriodDates, ensureAllowanceForUser } from "../ensure-allowance.ts";
import { checkBalance } from "../llm-credits.ts";

/**
 * A db double that knows exactly the four things the allowance code asks for.
 * Small on purpose: the point is the behaviour of "zero rows", not PostgREST.
 */
function fakeDb(opts: { role?: string; periods?: any[]; writable?: boolean } = {}) {
  const periods: any[] = opts.periods ?? [];
  const writable = opts.writable ?? true;
  const settings = [
    { key: "tokens_per_credit", value_int: 2000 },
    { key: "credits_free_per_month", value_int: 500 },
    { key: "credits_premium_per_month", value_int: 1500 },
  ];
  function builder(table: string) {
    const f: Array<(r: any) => boolean> = [];
    let upserted: any = null;
    const q: any = {
      select: () => q,
      eq: (c: string, v: any) => (f.push((r) => r[c] === v), q),
      gte: (c: string, v: any) => (f.push((r) => r[c] >= v), q),
      lte: (c: string, v: any) => (f.push((r) => r[c] <= v), q),
      lt: (c: string, v: any) => (f.push((r) => r[c] < v), q),
      order: () => q,
      limit: () => q,
      upsert: (row: any) => {
        if (!writable) { upserted = { error: { message: "permission denied for table ai_allowance_periods" } }; return q; }
        const dup = periods.find((p) => p.user_id === row.user_id && p.period_start === row.period_start);
        if (!dup) { periods.push(row); upserted = { data: row }; } else upserted = { data: null };
        return q;
      },
      maybeSingle: async () => {
        if (upserted) return { data: upserted.data ?? null, error: upserted.error ?? null };
        const rows = periods.filter((r) => f.every((fn) => fn(r)));
        return { data: rows[0] ?? null, error: null };
      },
      then: (resolve: any) => {
        if (table === "ai_credit_settings") return resolve({ data: settings, error: null });
        if (table === "v_ai_allowance_current") {
          const now = new Date().toISOString();
          const rows = periods
            .filter((r) => f.every((fn) => fn(r)) && r.period_start <= now && r.period_end >= now)
            .map((r) => ({ remaining_tokens: r.tokens_granted - r.tokens_used, remaining_credits: (r.tokens_granted - r.tokens_used) / 2000, period_start: r.period_start }));
          return resolve({ data: rows, error: null });
        }
        return resolve({ data: periods.filter((r) => f.every((fn) => fn(r))), error: null });
      },
    };
    return q;
  }
  return { periods, from: builder, rpc: async () => ({ data: opts.role ?? "free", error: null }) };
}

describe("ensureAllowanceForUser", () => {
  it("creates this month's free allowance when there is none", async () => {
    const db = fakeDb();
    const row = await ensureAllowanceForUser(db, "u1");
    expect(row.tokens_granted).toBe(500 * 2000);
    expect(row.source).toBe("free_tier");
    expect(row.period_start).toBe(allowancePeriodDates().period_start);
    expect(db.periods).toHaveLength(1);
  });

  it("returns the existing row and creates nothing", async () => {
    const { period_start, period_end } = allowancePeriodDates();
    const db = fakeDb({ periods: [{ user_id: "u1", period_start, period_end, tokens_granted: 7, tokens_used: 0 }] });
    const row = await ensureAllowanceForUser(db, "u1");
    expect(row.tokens_granted).toBe(7);
    expect(db.periods).toHaveLength(1);
  });

  it("rolls over LAST month's unused tokens (its end is this month's start), capped at one month's base", async () => {
    const now = new Date(Date.UTC(2026, 8, 20));
    const db = fakeDb({ periods: [{ user_id: "u1", period_start: "2026-08-01T00:00:00.000Z", period_end: "2026-09-01T00:00:00.000Z", tokens_granted: 5_000_000, tokens_used: 0 }] });
    const row = await ensureAllowanceForUser(db, "u1", now);
    expect(row.tokens_granted).toBe(2_000_000);
    expect(row.metadata.rollover_tokens).toBe(1_000_000);
  });
});

describe("checkBalance on an account nobody opened this month", () => {
  it("creates the allowance and allows the call, where it used to say no credits", async () => {
    const db = fakeDb();
    const res = await checkBalance(db, "u1");
    expect(res.allowed).toBe(true);
    expect(res.remaining_tokens).toBe(1_000_000);
    expect(db.periods).toHaveLength(1);
  });

  it("behaves as before when the client may not write the table", async () => {
    const db = fakeDb({ writable: false });
    const res = await checkBalance(db, "u1");
    expect(res.allowed).toBe(false);
    expect(res.unavailable).toBeUndefined();
  });
});
