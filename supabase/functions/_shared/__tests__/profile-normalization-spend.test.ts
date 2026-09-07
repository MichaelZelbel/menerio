import { webcrypto } from "node:crypto";
Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import * as spend from "../profile-normalization-spend";

import { readFileSync } from "node:fs";
vi.mock("../llm-router.ts", () => ({ runChat: vi.fn(async () => ({ content: '{"groups":[]}' })), resolveConfig: vi.fn(async (_db, _site, defaults) => ({ effective: defaults })) }));
import { runChat, resolveConfig } from "../llm-router.ts";
import { createNormalizationSuggestions, planSubjectNormalization } from "../profile-normalization.ts";

function fixtureDb(options: { readError?: string; insertError?: boolean } = {}) {
  const results = new Map<string, any>();
  let active: string | null = null;
  const entries = [
    { id: "1", category_id: "c", contact_id: null, label: "Favorite painting", value: "Sunrise", created_at: "2026-01-01" },
    { id: "2", category_id: "c", contact_id: null, label: "Favorite poem", value: "Evening", created_at: "2026-01-02" },
  ];
  const pending: any[] = [];
  const rpc = vi.fn(async (name: string, p: any) => {
    const key = `${p.p_user_id}:${p.p_contact_id}:${p.p_fingerprint}`;
    if (name === "claim_profile_normalization_input") {
      if (active) return { data: null, error: null };
      active = "lease";
      return { data: { lease_id: active, cached: !p.p_manual && results.has(key), result: results.get(key) }, error: null };
    }
    if (name === "stage_profile_normalization_input") results.set(key, p.p_result);
    if (name === "finish_profile_normalization_input") active = null;
    return { data: true, error: null };
  });
  const from = vi.fn((table: string) => {
    const data = table === "profile_entries" ? structuredClone(entries) : table === "profile_categories" ? [{ id: "c", slug: "hobbies" }] : table === "review_queue" ? pending : [];
    const q: any = { then: (resolve: any) => Promise.resolve({ data, error: options.readError === table ? new Error("read failed") : null }).then(resolve) };
    for (const method of ["select", "eq", "is", "in", "order", "limit", "contains"]) q[method] = () => q;
    q.insert = async () => ({ error: options.insertError ? new Error("insert failed") : null });
    return q;
  });
  return { rpc, from, entries, pending, results };
}
const helpers = { filterSuppressedSuggestions: async (_u: string, s: any[]) => s, prepareSuggestionForInsert: async (s: any) => s, isSensitiveSuggestion: () => false, buildSuppressionKey: () => "key" };
const prefs = { mode: "review", sensitivity: "balanced", autoAddSensitive: false };

describe("normalizer integration", () => {
  it("keeps a staged result but does not report completion when suggestion insertion fails", async () => {
    const db = fixtureDb({ insertError: true });
    vi.mocked(runChat).mockResolvedValueOnce({ content: JSON.stringify({ groups: [{ member_entry_ids: ["1"], survivor_entry_id: "1", canonical_category_slug: "hobbies", canonical_label: "Favorite painting", canonical_value: "New plan", operation: "reformat" }] }) } as any);
    await expect(createNormalizationSuggestions({ supabase: db, userId: "a", contactId: null, preferences: prefs, helpers })).rejects.toThrow("insert failed");
    expect(db.results.size).toBe(1);
    expect(db.rpc.mock.calls.some(([name]) => name === "finish_profile_normalization_input")).toBe(false);
  });
  it.each(["profile_entries", "profile_categories"])("does not pay on failed %s reads", async (table) => {
    vi.mocked(runChat).mockClear();
    const db = fixtureDb({ readError: table });
    await expect(createNormalizationSuggestions({ supabase: db, userId: "a", contactId: null, preferences: prefs, helpers })).rejects.toThrow("read failed");
    expect(runChat).not.toHaveBeenCalled();
  });
  it("fences suggestion effects after the evaluation lease expires", async () => {
    const db = fixtureDb();
    const rpc = db.rpc.getMockImplementation()!;
    db.rpc.mockImplementation(async (name, params) => name === "check_profile_normalization_input" ? { data: false, error: null } as any : rpc(name, params));
    vi.mocked(runChat).mockResolvedValueOnce({ content: JSON.stringify({ groups: [{ member_entry_ids: ["1"], survivor_entry_id: "1", canonical_category_slug: "hobbies", canonical_label: "Favorite painting", canonical_value: "New plan", operation: "reformat" }] }) } as any);
    await expect(createNormalizationSuggestions({ supabase: db, userId: "a", contactId: null, preferences: prefs, helpers })).rejects.toThrow("NORMALIZATION_LEASE_LOST");
  });
  it("refuses effects when a saved fact changed during the provider call", async () => {
    const db = fixtureDb();
    vi.mocked(runChat).mockImplementationOnce(async () => {
      db.entries[0].value = "User edited this";
      return { content: JSON.stringify({ groups: [{ member_entry_ids: ["1"], survivor_entry_id: "1", canonical_category_slug: "hobbies", canonical_label: "Favorite painting", canonical_value: "Old plan", operation: "reformat", confidence: 0.9 }] }) } as any;
    });
    await expect(createNormalizationSuggestions({ supabase: db, userId: "a", contactId: null, preferences: prefs, helpers })).rejects.toThrow("NORMALIZATION_INPUT_CHANGED");
    expect(db.rpc.mock.calls.some(([name]) => name === "finish_profile_normalization_input")).toBe(false);
  });
  it("ignores database row order while preserving changed facts and manual requests", async () => {
    vi.mocked(runChat).mockClear();
    const db = fixtureDb();
    const args = { supabase: db, userId: "a", contactId: null, preferences: prefs, helpers };
    await createNormalizationSuggestions(args);
    db.entries.reverse();
    await createNormalizationSuggestions(args);
    expect(runChat).toHaveBeenCalledTimes(1);
    db.entries[0].value = "Changed fact";
    await createNormalizationSuggestions(args);
    expect(runChat).toHaveBeenCalledTimes(2);
    await createNormalizationSuggestions({ ...args, manual: true });
    expect(runChat).toHaveBeenCalledTimes(3);
    await planSubjectNormalization(args);
    expect(runChat).toHaveBeenCalledTimes(4);
  });
  it("does not checkpoint malformed model output as a successful no-op", async () => {
    vi.mocked(runChat).mockResolvedValueOnce({ content: '{}' } as any);
    const db = fixtureDb();
    await expect(createNormalizationSuggestions({ supabase: db, userId: "a", contactId: null, preferences: prefs, helpers })).rejects.toThrow("INVALID_NORMALIZATION_RESULT");
    expect(db.results.size).toBe(0);
  });
  it("invalidates evaluated inputs for relevant pending suggestions and effective config changes", async () => {
    vi.mocked(runChat).mockClear();
    const db = fixtureDb();
    const args = { supabase: db, userId: "account", contactId: null, preferences: prefs, helpers };
    await createNormalizationSuggestions(args);
    db.pending.push({ id: "pending", payload: { contact_id: null, label: "Favorite painting", value: "Dawn" }, status: "pending_review" });
    await createNormalizationSuggestions(args);
    vi.mocked(resolveConfig).mockResolvedValueOnce({ effective: { model: "upgraded-model", system_prompt: "new schema" } } as any);
    await createNormalizationSuggestions(args);
    expect(runChat).toHaveBeenCalledTimes(3);
  });
  it("does not buy another automatic no-op for the same saved input", async () => {
    vi.mocked(runChat).mockClear();
    const db = fixtureDb();
    const args = { supabase: db, userId: "account", contactId: null, preferences: prefs, helpers };
    await createNormalizationSuggestions(args);
    await createNormalizationSuggestions(args);
    expect(runChat).toHaveBeenCalledTimes(1);
    expect(db.results.size).toBe(1);
  });
});

describe("durable normalization evaluation", () => {
  it("does not spend an uncertain paid retry when the balance gate refuses a call", async () => {
    const rpc = vi.fn(async (name: string) => ({ data: name === "claim_profile_normalization_input" ? { lease_id: "lease", cached: false } : true, error: null }));
    await expect(spend.evaluateNormalizationStage({ db: { rpc }, userId: "a", contactId: null, input: {}, evaluate: async () => { throw new Error("INSUFFICIENT_CREDITS"); } })).rejects.toThrow("INSUFFICIENT_CREDITS");
    expect(rpc.mock.calls.map(([name]) => name)).toEqual(["claim_profile_normalization_input", "defer_profile_normalization_input"]);
  });
  it("checkpoints a new paid result before returning it for effects", async () => {
    const calls: string[] = [];
    const rpc = vi.fn(async (name: string) => { calls.push(name); return { data: name === "claim_profile_normalization_input" ? { lease_id: "lease", cached: false } : true, error: null }; });
    const stage = await spend.evaluateNormalizationStage({ db: { rpc }, userId: "a", contactId: "person", input: { value: "new" }, evaluate: async () => { calls.push("provider"); return { groups: [] }; } });
    expect(calls).toEqual(["claim_profile_normalization_input", "provider", "stage_profile_normalization_input"]);
    expect(stage.result).toEqual({ groups: [] });
  });
  it("reuses a durable no-op without contacting the provider and holds the lease until finish", async () => {
    expect(typeof spend.evaluateNormalizationStage).toBe("function");
    const rpc = vi.fn(async (name: string) => ({ data: name === "claim_profile_normalization_input" ? { lease_id: "lease", result: { groups: [] }, cached: true } : true, error: null }));
    const evaluate = vi.fn();
    const stage = await spend.evaluateNormalizationStage({ db: { rpc }, userId: "account", contactId: null, input: { value: "a" }, evaluate });
    expect(evaluate).not.toHaveBeenCalled();
    expect(stage.result).toEqual({ groups: [] });
    expect(rpc).toHaveBeenCalledTimes(1);
    await stage.finish();
    expect(rpc.mock.calls[1][0]).toBe("finish_profile_normalization_input");
  });
});

describe("normalization input identity", () => {
  it("canonicalizes object keys but preserves actual input values and array order", async () => {
    expect(typeof spend.normalizationFingerprint).toBe("function");
    const hash = spend.normalizationFingerprint;
    expect(await hash({ user: "a", input: { value: "Paris", label: "City" } })).toBe(await hash({ input: { label: "City", value: "Paris" }, user: "a" }));
    expect(await hash({ value: "Paris" })).not.toBe(await hash({ value: "Rome" }));
    expect(await hash(["a", "b"])).not.toBe(await hash(["b", "a"]));
  });
});

const databaseUrl = process.env.NORMALIZATION_TEST_DATABASE_URL;
describe.skipIf(!databaseUrl)("real disposable PostgreSQL normalization lease", () => {
  let db: any;
  const user = "11111111-1111-4111-8111-111111111111";
  const hash = "a".repeat(64);
  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (!["127.0.0.1", "localhost"].includes(url.hostname) || url.pathname !== "/normalization_disposable") throw new Error("Requires isolated local normalization_disposable database");
    const { Client } = await import("pg");
    db = new Client({ connectionString: databaseUrl });
    await db.connect();
    await db.query(`
      do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
      do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
      do $$ begin create role service_role nologin; exception when duplicate_object then null; end $$;
      create schema if not exists auth;
      create table if not exists auth.users(id uuid primary key);
      create table if not exists public.contacts(id uuid primary key,user_id uuid not null);
    `);
    await db.query("insert into auth.users(id) values ($1) on conflict do nothing", [user]);
    const migration = "supabase/migrations/20260907123000_profile_normalization_inputs.sql";
    try { await db.query(readFileSync(migration, "utf8")); } catch (e: any) { if (e.code !== "ENOENT") throw e; }
  });
  afterAll(async () => { await db?.end(); });
  it("excludes concurrent sessions and fences expired tokens while caching no-op results", async () => {
    const { rows: installed } = await db.query("select to_regprocedure('public.claim_profile_normalization_input(uuid,uuid,text,boolean)') as routine");
    expect(installed[0].routine).not.toBeNull();
    await db.query("truncate public.profile_normalization_inputs, public.profile_normalization_leases");
    const { Client } = await import("pg");
    const other = new Client({ connectionString: databaseUrl });
    await other.connect();
    const claimSql = "select public.claim_profile_normalization_input($1,null,$2,false) as claim";
    try {
      const attempts = await Promise.all([db.query(claimSql, [user, hash]), other.query(claimSql, [user, hash])]);
      const owners = attempts.map(r => r.rows[0].claim).filter(c => c?.lease_id);
      expect(owners).toHaveLength(1);
      const old = owners[0].lease_id;
      expect((await db.query("select public.stage_profile_normalization_input($1,null,$2,$3,'{\"groups\":[]}'::jsonb) as ok", [user, hash, old])).rows[0].ok).toBe(true);
      await db.query("update public.profile_normalization_leases set lease_expires_at = now() - interval '1 second'");
      const next = (await other.query(claimSql, [user, hash])).rows[0].claim;
      expect(next.cached).toBe(true);
      expect(next.result).toEqual({ groups: [] });
      expect(next.lease_id).not.toBe(old);
      expect((await db.query("select public.finish_profile_normalization_input($1,null,$2,$3) as ok", [user, hash, old])).rows[0].ok).toBe(false);
      expect((await db.query("select public.finish_profile_normalization_input($1,null,$2,$3) as ok", [user, hash, next.lease_id])).rows[0].ok).toBe(true);
    } finally { await other.end(); }
  });
  it("bounds uncertain paid attempts per fingerprint without suppressing new input", async () => {
    await db.query("truncate public.profile_normalization_inputs, public.profile_normalization_leases");
    for (let i = 0; i < 3; i++) {
      expect((await db.query("select public.claim_profile_normalization_input($1,null,$2,false) as c", [user, hash])).rows[0].c?.lease_id).toBeTruthy();
      await db.query("update public.profile_normalization_leases set lease_expires_at = now() - interval '1 second'");
    }
    expect((await db.query("select public.claim_profile_normalization_input($1,null,$2,false) as c", [user, hash])).rows[0].c).toBeNull();
    expect((await db.query("select public.claim_profile_normalization_input($1,null,$2,false) as c", [user, "b".repeat(64)])).rows[0].c?.lease_id).toBeTruthy();
  });
  it("bounds retained completed plans for each subject", async () => {
    await db.query("truncate public.profile_normalization_inputs, public.profile_normalization_leases");
    await db.query(`insert into public.profile_normalization_inputs(user_id,subject_key,fingerprint,result,evaluated_at,completed_at)
      select $1,'owner',lpad(to_hex(n),64,'0'),'{"groups":[]}'::jsonb,now(),now() from generate_series(1,70) n`, [user]);
    await db.query("select public.claim_profile_normalization_input($1,null,$2,false)", [user, hash]);
    expect(Number((await db.query("select count(*) as n from public.profile_normalization_inputs")).rows[0].n)).toBeLessThanOrEqual(65);
  });
  it("isolates accounts and subjects and preserves explicit manual evaluation", async () => {
    await db.query("truncate public.profile_normalization_inputs, public.profile_normalization_leases");
    const otherUser = "22222222-2222-4222-8222-222222222222";
    const person = "33333333-3333-4333-8333-333333333333";
    await db.query("insert into auth.users values($1) on conflict do nothing", [otherUser]);
    await db.query("insert into public.contacts values($1,$2) on conflict do nothing", [person, user]);
    const claim = async (u: string, c: string | null, manual = false) => (await db.query("select public.claim_profile_normalization_input($1,$2,$3,$4) as c", [u, c, hash, manual])).rows[0].c;
    const owner = await claim(user, null);
    expect((await claim(otherUser, null))?.lease_id).toBeTruthy();
    expect((await claim(user, person))?.lease_id).toBeTruthy();
    await expect(claim(otherUser, person)).rejects.toThrow("Subject does not belong to account");
    expect(await claim(user, null, true)).toBeNull();
    expect((await db.query("select public.stage_profile_normalization_input($1,null,$2,$3,$4) as ok", [otherUser, hash, owner.lease_id, { groups: [] }])).rows[0].ok).toBe(false);
    await db.query("select public.stage_profile_normalization_input($1,null,$2,$3,$4)", [user, hash, owner.lease_id, { groups: [] }]);
    await db.query("select public.finish_profile_normalization_input($1,null,$2,$3)", [user, hash, owner.lease_id]);
    const manual = await claim(user, null, true);
    expect(manual.cached).toBe(false);
    expect(manual.lease_id).toBeTruthy();
  });
  it("parks balance refusals without exhausting paid retry attempts", async () => {
    const { rows } = await db.query("select to_regprocedure('public.defer_profile_normalization_input(uuid,uuid,text,uuid)') as routine");
    expect(rows[0].routine).not.toBeNull();
    await db.query("truncate public.profile_normalization_inputs, public.profile_normalization_leases");
    const claim = (await db.query("select public.claim_profile_normalization_input($1,null,$2,false) as c", [user, hash])).rows[0].c;
    expect((await db.query("select public.defer_profile_normalization_input($1,null,$2,$3) as ok", [user, hash, claim.lease_id])).rows[0].ok).toBe(true);
    expect(Number((await db.query("select attempts from public.profile_normalization_inputs")).rows[0].attempts)).toBe(0);
    expect((await db.query("select public.claim_profile_normalization_input($1,null,$2,false) as c", [user, hash])).rows[0].c).toBeNull();
  });
  it("installs service-only account-and-subject claim routines", async () => {
    const { rows } = await db.query("select to_regprocedure('public.claim_profile_normalization_input(uuid,uuid,text,boolean)') as routine");
    expect(rows[0].routine).not.toBeNull();
    const { rows: privileges } = await db.query("select has_function_privilege('anon','public.claim_profile_normalization_input(uuid,uuid,text,boolean)','execute') as anon, has_function_privilege('authenticated','public.claim_profile_normalization_input(uuid,uuid,text,boolean)','execute') as authenticated");
    expect(privileges[0]).toEqual({ anon: false, authenticated: false });
  });
});
