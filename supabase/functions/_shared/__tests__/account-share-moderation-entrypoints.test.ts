// @vitest-environment node
import { describe, expect, it } from "vitest";
import { sha256Hex } from "../sha256.ts";
import { fakeClient, loadFunction, type Row } from "./entrypoint-harness";

/**
 * get-shared-note, verify-connection, delete-my-account, admin-delete-user,
 * ai-moderate-content and ensure-token-allowance, each run as deployed: the
 * real index.ts bundled, only the database and the network synthetic.
 */

const ENV = {
  SUPABASE_URL: "https://synthetic.invalid",
  SUPABASE_SERVICE_ROLE_KEY: "service-key",
  SUPABASE_ANON_KEY: "anon-key",
  SUPABASE_PUBLISHABLE_KEY: "anon-key",
  LOVABLE_API_KEY: "lovable-key",
  RESEND_API_KEY: "resend-key",
};
// What the hosted edge runtime actually sets: SUPABASE_ANON_KEY (and the
// plural SUPABASE_PUBLISHABLE_KEYS, irrelevant here), never the singular
// SUPABASE_PUBLISHABLE_KEY. A function that reads only the singular throws
// "supabaseKey is required" in production even though it passes locally
// against ENV above.
const HOSTED_ENV = {
  SUPABASE_URL: "https://synthetic.invalid",
  SUPABASE_SERVICE_ROLE_KEY: "service-key",
  SUPABASE_ANON_KEY: "anon-key",
  LOVABLE_API_KEY: "lovable-key",
  RESEND_API_KEY: "resend-key",
};
const OWNER = "00000000-0000-4000-8000-00000000000a";
const OTHER = "00000000-0000-4000-8000-00000000000b";

describe("get-shared-note", () => {
  async function share(isTrashed: boolean) {
    const fake = fakeClient({
      tables: {
        shared_notes: [{ id: "s1", note_id: "n1", user_id: OWNER, share_token: "tok123456789", is_active: true }],
        notes: [{ id: "n1", user_id: OWNER, title: "Trip plan", content: "Day 1: museum", tags: [], entity_type: null, is_trashed: isTrashed, created_at: "2026-09-01", updated_at: "2026-09-02" }],
      },
    });
    const handler = await loadFunction("get-shared-note", fake.client, ENV);
    return handler(new Request("https://synthetic.invalid/get-shared-note?token=tok123456789"));
  }

  it("serves a shared note that is not in the trash", async () => {
    const res = await share(false);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ title: "Trip plan", content: "Day 1: museum" });
  });

  it("stops serving a shared note once its owner moved it to the trash", async () => {
    const res = await share(true);
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain("museum");
  });
});

describe("verify-connection", () => {
  async function verify(isActive: boolean) {
    const key = "app-key-123";
    const fake = fakeClient({
      tables: {
        connected_apps: [{ id: "a1", user_id: OWNER, app_name: "planner", key_hash: await sha256Hex(key), is_active: isActive, connection_status: "pending" }],
        profiles: [{ id: OWNER, display_name: "Owner" }],
      },
    });
    const handler = await loadFunction("verify-connection", fake.client, ENV);
    const res = await handler(new Request("https://synthetic.invalid/verify-connection", { method: "POST", headers: { "x-api-key": key } }));
    return { res, app: fake.tables.connected_apps[0] };
  }

  it("refuses an app its owner paused, and does not turn it active", async () => {
    const { res, app } = await verify(false);
    expect(res.status).toBe(401);
    expect(app.connection_status).toBe("pending");
  });

  it("still completes the handshake for an active app", async () => {
    const { res, app } = await verify(true);
    expect(res.status).toBe(200);
    expect(app.connection_status).toBe("active");
  });
});

describe("account deletion", () => {
  function accountTables(): Record<string, Row[]> {
    return {
      user_roles: [
        { id: "r1", user_id: OWNER, role: "premium" },
        { id: "r2", user_id: OTHER, role: "admin" },
      ],
      profiles: [{ id: OWNER, display_name: "Owner" }, { id: OTHER, display_name: "Admin" }],
      notes: [{ id: "n1", user_id: OWNER }],
    };
  }

  it("delete-my-account keeps role and profile when the auth delete fails", async () => {
    const fake = fakeClient({
      tables: accountTables(),
      user: { id: OWNER, email: "owner@example.test", identities: [{ provider: "google" }] },
      deleteUserError: { message: "Database error deleting user" },
    });
    const handler = await loadFunction("delete-my-account", fake.client, ENV);
    const res = await handler(new Request("https://synthetic.invalid/delete-my-account", {
      method: "POST", headers: { Authorization: "Bearer session" }, body: JSON.stringify({ confirm_email: "owner@example.test" }),
    }));
    expect(res.status).toBe(500);
    expect(fake.tables.user_roles.find((r) => r.user_id === OWNER)?.role).toBe("premium");
    expect(fake.tables.profiles.some((p) => p.id === OWNER)).toBe(true);
  });

  it("delete-my-account removes storage, then the auth user, then sweeps role and profile", async () => {
    const fake = fakeClient({ tables: accountTables(), user: { id: OWNER, email: "owner@example.test", identities: [{ provider: "google" }] } });
    const handler = await loadFunction("delete-my-account", fake.client, ENV);
    const res = await handler(new Request("https://synthetic.invalid/delete-my-account", {
      method: "POST", headers: { Authorization: "Bearer session" }, body: JSON.stringify({ confirm_email: "owner@example.test" }),
    }));
    expect(res.status).toBe(200);
    const order = fake.log.filter((l) => /^(storage\.list|auth\.deleteUser|delete )/.test(l));
    expect(order.indexOf(`auth.deleteUser ${OWNER}`)).toBeGreaterThan(order.lastIndexOf("storage.list note-attachments"));
    expect(order.indexOf(`auth.deleteUser ${OWNER}`)).toBeLessThan(order.findIndex((l) => l.startsWith("delete user_roles")));
    expect(fake.tables.notes).toHaveLength(0);
    expect(fake.tables.user_roles.map((r) => r.user_id)).toEqual([OTHER]);
  });

  it("admin-delete-user keeps the target's role and profile when the auth delete fails", async () => {
    const fake = fakeClient({
      tables: accountTables(),
      user: { id: OTHER, email: "admin@example.test" },
      deleteUserError: { message: "Database error deleting user" },
      rpcs: { record_staff_access: () => ({ data: "log-id", error: null }) },
    });
    const handler = await loadFunction("admin-delete-user", fake.client, ENV);
    const res = await handler(new Request("https://synthetic.invalid/admin-delete-user", {
      method: "POST", headers: { Authorization: "Bearer session" }, body: JSON.stringify({ target_user_id: OWNER }),
    }));
    expect(res.status).toBe(500);
    expect(fake.tables.user_roles.find((r) => r.user_id === OWNER)?.role).toBe("premium");
    expect(fake.tables.profiles.some((p) => p.id === OWNER)).toBe(true);
  });

  it("admin-delete-user removes nothing when the staff log cannot be written", async () => {
    const fake = fakeClient({
      tables: accountTables(),
      user: { id: OTHER, email: "admin@example.test" },
      rpcs: { record_staff_access: () => ({ data: null, error: { message: "log store down" } }) },
    });
    const handler = await loadFunction("admin-delete-user", fake.client, ENV);
    const res = await handler(new Request("https://synthetic.invalid/admin-delete-user", {
      method: "POST", headers: { Authorization: "Bearer session" }, body: JSON.stringify({ target_user_id: OWNER }),
    }));
    expect(res.status).toBe(503);
    expect(fake.tables.user_roles.find((r) => r.user_id === OWNER)?.role).toBe("premium");
    expect(fake.tables.profiles.some((p) => p.id === OWNER)).toBe(true);
    expect(fake.log).not.toContain(`auth.deleteUser ${OWNER}`);
  });

  it("delete-my-account works on the hosted runtime, which sets SUPABASE_ANON_KEY and not SUPABASE_PUBLISHABLE_KEY", async () => {
    const fake = fakeClient({ tables: accountTables(), user: { id: OWNER, email: "owner@example.test", identities: [{ provider: "email" }] }, password: "correct-horse" });
    const handler = await loadFunction("delete-my-account", fake.client, HOSTED_ENV);
    const res = await handler(new Request("https://synthetic.invalid/delete-my-account", {
      method: "POST", headers: { Authorization: "Bearer session" }, body: JSON.stringify({ password: "correct-horse" }),
    }));
    expect(res.status).toBe(200);
    expect(fake.log).toContain(`auth.deleteUser ${OWNER}`);
  });

  it("admin-delete-user works on the hosted runtime, which sets SUPABASE_ANON_KEY and not SUPABASE_PUBLISHABLE_KEY", async () => {
    const fake = fakeClient({
      tables: accountTables(),
      user: { id: OTHER, email: "admin@example.test" },
      rpcs: { record_staff_access: () => ({ data: "log-id", error: null }) },
    });
    const handler = await loadFunction("admin-delete-user", fake.client, HOSTED_ENV);
    const res = await handler(new Request("https://synthetic.invalid/admin-delete-user", {
      method: "POST", headers: { Authorization: "Bearer session" }, body: JSON.stringify({ target_user_id: OWNER }),
    }));
    expect(res.status).toBe(200);
    expect(fake.log).toContain(`auth.deleteUser ${OWNER}`);
  });

  it("admin-delete-user logs the staff access exactly once, before any delete", async () => {
    const fake = fakeClient({
      tables: accountTables(),
      user: { id: OTHER, email: "admin@example.test" },
      rpcs: { record_staff_access: () => ({ data: "log-id", error: null }) },
    });
    const handler = await loadFunction("admin-delete-user", fake.client, ENV);
    const res = await handler(new Request("https://synthetic.invalid/admin-delete-user", {
      method: "POST", headers: { Authorization: "Bearer session" }, body: JSON.stringify({ target_user_id: OWNER }),
    }));
    expect(res.status).toBe(200);
    expect(fake.log.filter((l) => l === "rpc record_staff_access")).toHaveLength(1);
    const logIndex = fake.log.indexOf("rpc record_staff_access");
    const firstDeleteIndex = fake.log.findIndex((l) => l.startsWith("storage.list") || l.startsWith("auth.deleteUser") || l.startsWith("delete "));
    expect(logIndex).toBeGreaterThan(-1);
    expect(logIndex).toBeLessThan(firstDeleteIndex);
  });
});

describe("ai-moderate-content", () => {
  it("two runs at once act on a violation once: one strike, one email, one unshare", async () => {
    const fake = fakeClient({
      tables: {
        user_roles: [],
        moderation_review_queue: [{ id: "q1", item_type: "note", item_id: "n1", user_id: OWNER, status: "pending", retry_count: 0, created_at: "2026-09-29" }],
        shared_notes: [{ id: "s1", note_id: "n1", user_id: OWNER, is_active: true }],
        notes: [{ id: "n1", user_id: OWNER, title: "Title", content: "body" }],
        moderation_events: [],
      },
      rpcs: {
        record_content_strike: () => ({ data: null, error: null }),
        record_staff_access: () => ({ data: "log-id", error: null }),
      },
    });
    // Both runs have read the queue before either decides: the classifier
    // answers only once both have asked.
    let asked = 0;
    let release: () => void = () => {};
    const bothAsked = new Promise<void>((resolve) => { release = resolve; });
    const emails: string[] = [];
    const globals = {
      testRunChat: async () => {
        if (++asked === 2) release();
        await bothAsked;
        return { raw: { choices: [{ message: { tool_calls: [{ function: { arguments: JSON.stringify({ is_violation: true, category: "hate", confidence: 0.99, reason: "slur" }) } }] } }] } };
      },
    };
    const options = {
      globals,
      fetch: async (url: string) => { emails.push(url); return new Response("{}"); },
      stubs: [{ filter: /llm-router\.ts$/, contents: "export const runChat = (...a) => globalThis.testRunChat(...a)" }],
    };
    const run = await loadFunction("ai-moderate-content", fake.client, ENV, options);
    const req = () => new Request("https://synthetic.invalid/ai-moderate-content", { method: "POST", headers: { Authorization: "Bearer service-key" } });
    const [a, b] = await Promise.all([run(req()), run(req())]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(fake.log.filter((l) => l === "rpc record_content_strike")).toHaveLength(1);
    expect(emails).toHaveLength(1);
    expect(fake.tables.moderation_events).toHaveLength(1);
    expect(fake.tables.moderation_review_queue[0].status).toBe("violation");
    expect(fake.tables.shared_notes[0].is_active).toBe(false);
    expect(Object.keys(fake.tables.moderation_events[0])).not.toContain("flagged_content");
    expect(fake.tables.moderation_review_queue[0]).not.toHaveProperty("ai_reason");
  });

  it("a queued note whose share is no longer active ends skipped, with no classifier call and no staff-log row", async () => {
    const fake = fakeClient({
      tables: {
        moderation_review_queue: [{ id: "q1", item_type: "note", item_id: "n1", user_id: OWNER, status: "pending", retry_count: 0, created_at: "2026-09-29" }],
        shared_notes: [{ id: "s1", note_id: "n1", user_id: OWNER, is_active: false }],
        notes: [{ id: "n1", user_id: OWNER, title: "Title", content: "body" }],
      },
      rpcs: { record_staff_access: () => ({ data: "log-id", error: null }) },
    });
    let classifierCalled = false;
    const run = await loadFunction("ai-moderate-content", fake.client, ENV, {
      globals: { testRunChat: async () => { classifierCalled = true; return null; } },
      stubs: [{ filter: /llm-router\.ts$/, contents: "export const runChat = (...a) => globalThis.testRunChat(...a)" }],
    });
    const res = await run(new Request("https://synthetic.invalid/ai-moderate-content", { method: "POST", headers: { Authorization: "Bearer service-key" } }));
    expect(res.status).toBe(200);
    expect(classifierCalled).toBe(false);
    expect(fake.tables.moderation_review_queue[0].status).toBe("skipped");
    expect(fake.log.filter((l) => l === "rpc record_staff_access")).toHaveLength(0);
  });

  it("when record_staff_access errs, the classifier is never called and the item stays pending with retry_count incremented", async () => {
    const fake = fakeClient({
      tables: {
        moderation_review_queue: [{ id: "q1", item_type: "note", item_id: "n1", user_id: OWNER, status: "pending", retry_count: 0, created_at: "2026-09-29" }],
        shared_notes: [{ id: "s1", note_id: "n1", user_id: OWNER, is_active: true }],
        notes: [{ id: "n1", user_id: OWNER, title: "Title", content: "body" }],
      },
      rpcs: { record_staff_access: () => ({ data: null, error: { message: "log store down" } }) },
    });
    let classifierCalled = false;
    const run = await loadFunction("ai-moderate-content", fake.client, ENV, {
      globals: { testRunChat: async () => { classifierCalled = true; return null; } },
      stubs: [{ filter: /llm-router\.ts$/, contents: "export const runChat = (...a) => globalThis.testRunChat(...a)" }],
    });
    const res = await run(new Request("https://synthetic.invalid/ai-moderate-content", { method: "POST", headers: { Authorization: "Bearer service-key" } }));
    expect(res.status).toBe(200);
    expect(classifierCalled).toBe(false);
    expect(fake.tables.moderation_review_queue[0].status).toBe("pending");
    expect(fake.tables.moderation_review_queue[0].retry_count).toBe(1);
  });

  it("when the shared-note read errors, the item stays pending with retry_count incremented, not skipped", async () => {
    const fake = fakeClient({
      tables: {
        moderation_review_queue: [{ id: "q1", item_type: "note", item_id: "n1", user_id: OWNER, status: "pending", retry_count: 0, created_at: "2026-09-29" }],
        shared_notes: [{ id: "s1", note_id: "n1", user_id: OWNER, is_active: true }],
        notes: [{ id: "n1", user_id: OWNER, title: "Title", content: "body" }],
      },
      selectErrors: { shared_notes: { message: "connection reset" } },
    });
    let classifierCalled = false;
    const run = await loadFunction("ai-moderate-content", fake.client, ENV, {
      globals: { testRunChat: async () => { classifierCalled = true; return null; } },
      stubs: [{ filter: /llm-router\.ts$/, contents: "export const runChat = (...a) => globalThis.testRunChat(...a)" }],
    });
    const res = await run(new Request("https://synthetic.invalid/ai-moderate-content", { method: "POST", headers: { Authorization: "Bearer service-key" } }));
    expect(res.status).toBe(200);
    expect(classifierCalled).toBe(false);
    expect(fake.tables.moderation_review_queue[0].status).toBe("pending");
    expect(fake.tables.moderation_review_queue[0].retry_count).toBe(1);
  });

  it("still refuses a caller that is neither the service key nor an admin", async () => {
    const fake = fakeClient({ tables: { user_roles: [{ user_id: OWNER, role: "premium" }] }, user: { id: OWNER } });
    const run = await loadFunction("ai-moderate-content", fake.client, ENV, {
      stubs: [{ filter: /llm-router\.ts$/, contents: "export const runChat = async () => { throw new Error('not reached') }" }],
    });
    const res = await run(new Request("https://synthetic.invalid/ai-moderate-content", { method: "POST", headers: { Authorization: "Bearer service-kez" } }));
    expect(res.status).toBe(403);
  });
});

describe("ensure-token-allowance", () => {
  function allowanceClient(user: Row | null) {
    return fakeClient({
      tables: {
        ai_allowance_periods: [],
        ai_credit_settings: [{ key: "tokens_per_credit", value_int: 200 }, { key: "credits_free_per_month", value_int: 10 }],
      },
      user: user as never,
      rpcs: { get_user_role: () => ({ data: "free", error: null }), is_admin: () => ({ data: false, error: null }) },
    });
  }
  const call = (handler: (r: Request) => Promise<Response>, bearer: string, body: Row) =>
    handler(new Request("https://synthetic.invalid/ensure-token-allowance", { method: "POST", headers: { Authorization: `Bearer ${bearer}` }, body: JSON.stringify(body) }));

  it("lets the service key act for any account", async () => {
    const fake = allowanceClient(null);
    const handler = await loadFunction("ensure-token-allowance", fake.client, ENV);
    const res = await call(handler, "service-key", { user_id: OTHER });
    expect(res.status).toBe(200);
    expect(fake.tables.ai_allowance_periods.map((p) => p.user_id)).toEqual([OTHER]);
    expect(fake.log).not.toContain("rpc record_staff_access");
  });

  it("treats a near-miss of the service key as a session, which may not act for another account", async () => {
    const fake = allowanceClient({ id: OWNER });
    const handler = await loadFunction("ensure-token-allowance", fake.client, ENV);
    const res = await call(handler, "service-kez", { user_id: OTHER });
    expect(res.status).toBe(403);
    expect(fake.tables.ai_allowance_periods).toHaveLength(0);
  });

  it("never logs a user's own request for their own allowance", async () => {
    const fake = allowanceClient({ id: OWNER });
    const handler = await loadFunction("ensure-token-allowance", fake.client, ENV);
    const res = await call(handler, "session", { user_id: OWNER });
    expect(res.status).toBe(200);
    expect(fake.tables.ai_allowance_periods.map((p) => p.user_id)).toEqual([OWNER]);
    expect(fake.log).not.toContain("rpc record_staff_access");
  });

  it("logs the staff access with the right arguments when an admin acts on another account", async () => {
    let staffAccessArgs: Row | null = null;
    const fake = fakeClient({
      tables: {
        ai_allowance_periods: [],
        ai_credit_settings: [{ key: "tokens_per_credit", value_int: 200 }, { key: "credits_free_per_month", value_int: 10 }],
      },
      user: { id: OTHER },
      rpcs: {
        get_user_role: () => ({ data: "free", error: null }),
        is_admin: () => ({ data: true, error: null }),
        record_staff_access: (args) => { staffAccessArgs = args; return { data: "log-id", error: null }; },
      },
    });
    const handler = await loadFunction("ensure-token-allowance", fake.client, ENV);
    const res = await call(handler, "session", { user_id: OWNER });
    expect(res.status).toBe(200);
    expect(fake.log.filter((l) => l === "rpc record_staff_access")).toHaveLength(1);
    expect(staffAccessArgs).toEqual({
      p_subject: OWNER, p_actor: OTHER, p_actor_kind: "admin", p_action: "ensure_allowance", p_note_id: null,
    });
  });

  it("creates no allowance row for another account when the staff log cannot be written", async () => {
    const withFailingLog = fakeClient({
      tables: {
        ai_allowance_periods: [],
        ai_credit_settings: [{ key: "tokens_per_credit", value_int: 200 }, { key: "credits_free_per_month", value_int: 10 }],
      },
      user: { id: OWNER },
      rpcs: {
        get_user_role: () => ({ data: "free", error: null }),
        is_admin: () => ({ data: true, error: null }),
        record_staff_access: () => ({ data: null, error: { message: "log store down" } }),
      },
    });
    const handler = await loadFunction("ensure-token-allowance", withFailingLog.client, ENV);
    const res = await call(handler, "session", { user_id: OTHER });
    expect(res.status).toBe(503);
    expect(withFailingLog.tables.ai_allowance_periods).toHaveLength(0);
  });
});
