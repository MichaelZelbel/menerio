
import { afterEach, beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { deductTokens } from "../llm-credits.ts";
import { runChat, runOcr } from "../llm-router.ts";
import { readFileSync, existsSync } from "node:fs";
import { Client } from "pg";

afterEach(() => vi.unstubAllGlobals());

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

// In-memory RPC boundary fixture, not a database concurrency proof.
function databaseFixture() {
  const events: Record<string, unknown>[] = [];
  const from = vi.fn((table: string) => {
    if (table === "llm_usage_events") throw new Error("Must not look up newest usage");
    const query = {
      select: () => query, eq: () => query, order: () => query,
      limit: async () => ({ data: [{ remaining_tokens: 10000, remaining_credits: 50 }] }),
      maybeSingle: async () => ({ data: null }),
    };
    return query;
  });
  const rpc = vi.fn(async (name: string, params: Record<string, unknown>) => {
    if (name === "llm_note_call_fingerprint") return { data: { allowed: true } };
    events.push(params);
    return { data: { allowed: true, tokens_deducted: params.p_tokens,
      remaining_tokens: 9000, remaining_credits: 45, usage_event_id: params.p_feature } };
  });
  vi.stubGlobal("Deno", { env: { get: () => "synthetic-test-key" } });
  return { db: { from, rpc }, events };
}

describe("exact usage attribution", () => {
  it("passes the known note from both media OCR callers", () => {
    const source = readFileSync("supabase/functions/analyze-media/index.ts", "utf8");
    const calls = [...source.matchAll(/await runOcr\(\{([\s\S]*?)\}\);/g)];
    expect(calls).toHaveLength(2);
    for (const [, body] of calls) expect(body).toMatch(/\bnoteId\s*,/);
  });
  it("attributes OCR in its only deduction without selecting a usage row", async () => {
    const { db, events } = databaseFixture();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      pages: [{ markdown: "fixture" }], usage_info: { pages_processed: 2 },
    }))));
    await runOcr({ db, userId: "user-a", callSite: "ocr-fixture", noteId: "note-ocr",
      jobId: "job-ocr", revision: "rev-ocr", stage: "ocr", idempotencyKey: "ocr-attempt", document: {}, defaults: { model: "fixture" } });
    expect(events).toEqual([expect.objectContaining({ p_tokens: 1000, p_feature: "ocr-fixture",
      p_call_site: "ocr-fixture", p_note_id: "note-ocr", p_job_id: "job-ocr",
      p_revision: "rev-ocr", p_stage: "ocr", p_usage_source: "fallback", p_idempotency_key: "ocr-attempt" })]);
    expect(db.from).not.toHaveBeenCalledWith("llm_usage_events");
  });
  it("keeps each chat's note and job when the second provider finishes first", async () => {
    const { db, events } = databaseFixture();
    const first = deferred<Response>();
    const second = deferred<Response>();
    const fetchMock = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    vi.stubGlobal("fetch", fetchMock);
    const invoke = (name: string) => runChat({ db, userId: "user-a", callSite: name,
      noteId: `note-${name}`, jobId: `job-${name}`, revision: `rev-${name}`, stage: "metadata",
      idempotencyKey: `attempt-${name}`,
      messages: [{ role: "user", content: name }], defaults: { provider: "openrouter", model: "fixture" } });
    const a = invoke("first");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const b = invoke("second");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const response = () => new Response(JSON.stringify({ choices: [{ message: { content: "fixture" } }], usage: { total_tokens: 200 } }));
    second.resolve(response());
    await b;
    first.resolve(response());
    await a;
    expect(events).toEqual(["second", "first"].map((name) => expect.objectContaining({
      p_feature: name, p_call_site: name, p_note_id: `note-${name}`, p_job_id: `job-${name}`,
      p_revision: `rev-${name}`, p_stage: "metadata", p_config_source: "fallback-default",
      p_idempotency_key: `attempt-${name}`,
    })));
    expect(db.from).not.toHaveBeenCalledWith("llm_usage_events");
  });
  it("passes attribution in the same RPC as the charge", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: {
      allowed: true, remaining_tokens: 800, remaining_credits: 4,
      tokens_deducted: 200, usage_event_id: "event-a",
    }, error: null });
    const result = await deductTokens({ rpc }, {
      userId: "user-a", tokens: 200, feature: "analysis", callSite: "analysis",
      configSource: "fallback-default", noteId: "note-a", jobId: "job-a",
      revision: "revision-a", stage: "metadata", idempotencyKey: "attempt-a",
    });
    expect(rpc).toHaveBeenCalledWith("deduct_ai_tokens_attributed", expect.objectContaining({
      p_call_site: "analysis", p_config_source: "fallback-default", p_note_id: "note-a",
      p_job_id: "job-a", p_revision: "revision-a", p_stage: "metadata",
      p_idempotency_key: "attempt-a",
    }));
    expect(result.usage_event_id).toBe("event-a");
  });
});

// Opt-in real SQL tests. Only the explicitly named loopback disposable database
// is accepted; its public schema is cleared after testing. No customer data.
const databaseUrl = process.env.MENERIO_USAGE_TEST_DATABASE_URL;
describe.skipIf(!databaseUrl)("attribution SQL on disposable PostgreSQL", () => {
  let sql: Client;
  const user = "00000000-0000-4000-8000-000000000001";
  const note = "00000000-0000-4000-8000-000000000002";
  const job = "00000000-0000-4000-8000-000000000003";
  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || url.pathname !== "/usage_disposable") {
      throw new Error("Usage SQL tests require a loopback usage_disposable database");
    }
    sql = new Client({ connectionString: databaseUrl });
    await sql.connect();
    await sql.query(`BEGIN;
      DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
      DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
      DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
      CREATE TABLE ai_allowance_periods (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid,
        tokens_granted bigint, tokens_used bigint, metadata jsonb DEFAULT '{}',
        period_start timestamptz DEFAULT now() - interval '1 day',
        period_end timestamptz DEFAULT now() + interval '1 day', updated_at timestamptz);
      CREATE TABLE llm_usage_events (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, feature text,
        model text, provider text, prompt_tokens integer, completion_tokens integer,
        total_tokens integer, credits_charged numeric, idempotency_key text,
        metadata jsonb, call_site text, config_source text, note_id uuid,
        created_at timestamptz DEFAULT now());
      CREATE UNIQUE INDEX ON llm_usage_events(idempotency_key) WHERE idempotency_key IS NOT NULL;
    `);
    await sql.query(readFileSync("supabase/migrations/20260827101500_deduct_ai_tokens_charge_and_land_on_zero.sql", "utf8"));
    const migration = "supabase/migrations/20260907103000_llm_usage_exact_attribution.sql";
    if (existsSync(migration)) await sql.query(readFileSync(migration, "utf8"));
    await sql.query("COMMIT");
  });
  afterAll(async () => { if (sql) { await sql.query("ROLLBACK; DROP SCHEMA public CASCADE; CREATE SCHEMA public"); await sql.end(); } });

  it("records full capped cost and exact attribution atomically", async () => {
    const functions = await sql.query("select proname from pg_proc where proname = 'deduct_ai_tokens_attributed'");
    expect(functions.rows).toHaveLength(1);
    await sql.query("insert into ai_allowance_periods(user_id,tokens_granted,tokens_used) values ($1,1000,900)", [user]);
    const result = await sql.query(`select deduct_ai_tokens_attributed(
      p_user_id => $1, p_tokens => 500, p_feature => 'ocr', p_call_site => 'ocr',
      p_note_id => $2, p_job_id => $3, p_revision => 'rev1', p_stage => 'ocr',
      p_idempotency_key => 'capped-fixture', p_usage_source => 'fallback') as value`, [user, note, job]);
    const credit = result.rows[0].value;
    expect(credit).toMatchObject({ allowed: true, capped: true, tokens_deducted: 100,
      overdraft_tokens: 400, remaining_tokens: 0, remaining_credits: 0 });
    const events = await sql.query("select * from llm_usage_events where id = $1", [credit.usage_event_id]);
    expect(events.rows).toHaveLength(1);
    expect(events.rows[0]).toMatchObject({ feature: "ocr", call_site: "ocr", note_id: note,
      job_id: job, revision: "rev1", stage: "ocr", total_tokens: 500 });
    const balance = await sql.query("select tokens_used from ai_allowance_periods where user_id = $1", [user]);
    expect(Number(balance.rows[0].tokens_used)).toBe(1000);
    // A later top-up must not make replay of the capped call consume it.
    await sql.query("update ai_allowance_periods set tokens_granted=2000 where user_id=$1", [user]);
    const replay = await sql.query(`select deduct_ai_tokens_attributed(
      p_user_id => $1, p_tokens => 500, p_feature => 'ocr', p_call_site => 'ocr',
      p_note_id => $2, p_job_id => $3, p_revision => 'rev1', p_stage => 'ocr',
      p_idempotency_key => 'capped-fixture', p_usage_source => 'fallback') as value`, [user, note, job]);
    expect(replay.rows[0].value).toEqual(credit);
    expect(Number((await sql.query("select tokens_used from ai_allowance_periods where user_id=$1", [user])).rows[0].tokens_used)).toBe(1000);
  });
  it("replays the original deduction result without charging again", async () => {
    await sql.query("update ai_allowance_periods set tokens_granted=5000, tokens_used=0 where user_id=$1", [user]);
    const query = `select deduct_ai_tokens_attributed(p_user_id=>$1, p_tokens=>500,
      p_feature=>'analysis', p_idempotency_key=>'retry-fixture', p_call_site=>'analysis',
      p_note_id=>$2, p_job_id=>$3, p_revision=>'rev2', p_stage=>'metadata') as value`;
    const first = (await sql.query(query, [user, note, job])).rows[0].value;
    const retry = (await sql.query(query, [user, note, job])).rows[0].value;
    expect(retry).toEqual(first);
    const balance = await sql.query("select tokens_used from ai_allowance_periods where user_id=$1", [user]);
    expect(Number(balance.rows[0].tokens_used)).toBe(500);
    expect((await sql.query("select id from llm_usage_events where idempotency_key='retry-fixture'")).rows).toHaveLength(1);
  });
  it("serializes concurrent retries before either can charge twice", async () => {
    await sql.query("update ai_allowance_periods set tokens_granted=5000,tokens_used=0 where user_id=$1", [user]);
    const a = new Client({ connectionString: databaseUrl });
    const b = new Client({ connectionString: databaseUrl });
    await a.connect(); await b.connect();
    const query = `select deduct_ai_tokens_attributed(p_user_id=>$1,p_tokens=>500,
      p_feature=>'concurrent',p_idempotency_key=>'concurrent-fixture') as value`;
    try {
      await a.query("BEGIN");
      const first = (await a.query(query, [user])).rows[0].value;
      const pid = (await b.query("select pg_backend_pid() as pid")).rows[0].pid;
      const pending = b.query(query, [user]);
      await vi.waitFor(async () => {
        const wait = (await sql.query("select wait_event_type from pg_stat_activity where pid=$1", [pid])).rows[0];
        expect(wait.wait_event_type).toBe("Lock");
      });
      await a.query("COMMIT");
      const second = (await pending).rows[0].value;
      expect(second).toEqual(first);
      const balance = await sql.query("select tokens_used from ai_allowance_periods where user_id=$1", [user]);
      expect(Number(balance.rows[0].tokens_used)).toBe(500);
    } finally {
      await a.query("ROLLBACK"); await a.end(); await b.end();
    }
  });
  it("rejects a reused key with different attribution without touching the event", async () => {
    const before = (await sql.query("select * from llm_usage_events where idempotency_key='retry-fixture'")).rows[0];
    await expect(sql.query(`select deduct_ai_tokens_attributed(p_user_id=>$1,p_tokens=>500,
      p_feature=>'analysis',p_idempotency_key=>'retry-fixture',p_note_id=>$2,p_stage=>'different')`, [user, note]))
      .rejects.toThrow("idempotency_key_conflict");
    const after = (await sql.query("select * from llm_usage_events where idempotency_key='retry-fixture'")).rows[0];
    expect(after).toEqual(before);
  });
  it("refuses another tenant's idempotency key before any deduction", async () => {
    const other = "00000000-0000-4000-8000-000000000099";
    await sql.query("insert into ai_allowance_periods(user_id,tokens_granted,tokens_used) values($1,2000,0)", [other]);
    await expect(sql.query(`select deduct_ai_tokens_attributed(p_user_id=>$1,p_tokens=>500,
      p_feature=>'analysis',p_idempotency_key=>'retry-fixture')`, [other])).rejects.toThrow("idempotency_key_conflict");
    expect(Number((await sql.query("select tokens_used from ai_allowance_periods where user_id=$1", [other])).rows[0].tokens_used)).toBe(0);
  });
  it("does not rewrite a legacy event whose exact retry request is unknown", async () => {
    await sql.query("insert into llm_usage_events(user_id,feature,idempotency_key) values($1,'legacy','legacy-fixture')", [user]);
    const before = (await sql.query("select * from llm_usage_events where idempotency_key='legacy-fixture'")).rows[0];
    await expect(sql.query(`select deduct_ai_tokens_attributed(p_user_id=>$1,p_tokens=>500,
      p_feature=>'legacy',p_idempotency_key=>'legacy-fixture')`, [user])).rejects.toThrow("idempotency_key_conflict");
    expect((await sql.query("select * from llm_usage_events where idempotency_key='legacy-fixture'")).rows[0]).toEqual(before);
  });
  it("preserves no-active-period refusal without creating a usage event", async () => {
    const result = await sql.query(`select deduct_ai_tokens_attributed(
      p_user_id=>'00000000-0000-4000-8000-000000000098',p_tokens=>500,
      p_feature=>'missing',p_idempotency_key=>'missing-fixture') as value`);
    expect(result.rows[0].value).toMatchObject({ allowed: false, error: "no_active_period", remaining_tokens: 0 });
    expect((await sql.query("select id from llm_usage_events where idempotency_key='missing-fixture'")).rows).toHaveLength(0);
  });
  it("grants the new deduction surface only to the service role", async () => {
    const signature = "deduct_ai_tokens_attributed(uuid,integer,text,text,text,integer,integer,text,text,text,text,uuid,uuid,text,text)";
    for (const role of ["anon", "authenticated", "service_role"]) {
      expect((await sql.query("select has_function_privilege($1,$2,'EXECUTE') as allowed", [role, signature])).rows[0].allowed)
        .toBe(role === "service_role");
    }
  });
});