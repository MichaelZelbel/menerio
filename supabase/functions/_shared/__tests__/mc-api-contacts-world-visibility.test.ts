// @vitest-environment node
import { describe, expect, it } from "vitest";
import { sha256Hex } from "../sha256.ts";
import { fakeClient, loadFunction, type Row } from "./entrypoint-harness";

/**
 * A Mission Control key and the people it may not see (review 2026-09-29).
 *
 * mc-api-contacts: a person hidden from AI, merged away or another user's is
 * "not found" to a key, for writes as well as reads; a person marked sensitive
 * can be read in redacted form but not changed; merged-away records are not
 * listed or counted.
 *
 * mc-api-world: relationships are read from agent_world_claims, which leaves
 * out hidden, sensitive and merged-away people in the database, instead of an
 * id list in the URL that failed past a few hundred people; a sensitive
 * entity is left out of the mirror like a sensitive person.
 */

const KEY = "mnr_" + "e".repeat(48);
const USER = "00000000-0000-4000-8000-00000000000a";
const OTHER = "00000000-0000-4000-8000-00000000000b";
const ANNA = "00000000-0000-4000-8000-0000000000a1";
const HIDDEN = "00000000-0000-4000-8000-0000000000a2";
const SAM = "00000000-0000-4000-8000-0000000000a3"; // sensitive
const MERGED = "00000000-0000-4000-8000-0000000000a4";
const STRANGER = "00000000-0000-4000-8000-0000000000a5"; // another user's
const ENV = { SUPABASE_URL: "https://synthetic.invalid", SUPABASE_SERVICE_ROLE_KEY: "service-key" };

async function world() {
  const tables: Record<string, Row[]> = {
    godspeed_api_keys: [{ id: "key-1", user_id: USER, key_hash: await sha256Hex(KEY), scopes: ["contacts", "world"], is_active: true, expires_at: null, godspeed_connection_id: null, generation: null }],
    mcp_preferences: [],
    contacts: [
      { id: ANNA, user_id: USER, name: "Anna", email: "anna@example.invalid", ai_visibility: "visible", is_sensitive: false, merged_into: null, updated_at: "2026-09-01" },
      { id: HIDDEN, user_id: USER, name: "SECRET-hidden-name", ai_visibility: "hidden", is_sensitive: false, merged_into: null, updated_at: "2026-09-02" },
      { id: SAM, user_id: USER, name: "Sam", email: "SECRET-sam@example.invalid", ai_visibility: "visible", is_sensitive: true, merged_into: null, updated_at: "2026-09-03" },
      { id: MERGED, user_id: USER, name: "Anna (duplicate)", ai_visibility: "visible", is_sensitive: false, merged_into: ANNA, updated_at: "2026-09-04" },
      { id: STRANGER, user_id: OTHER, name: "SECRET-stranger", ai_visibility: "visible", is_sensitive: false, merged_into: null, updated_at: "2026-09-05" },
    ],
    contact_interactions: [],
    notes: [],
    world_entities: [
      { id: ANNA, user_id: USER, source_table: "contact", kind: "person", name: "Anna", aliases: [], ai_visibility: "visible", is_sensitive: false, updated_at: "2026-09-01" },
      { id: SAM, user_id: USER, source_table: "contact", kind: "person", name: "SECRET-sam-entity", aliases: [], ai_visibility: "visible", is_sensitive: true, updated_at: "2026-09-02" },
      { id: "e-clinic", user_id: USER, source_table: "entity", kind: "organization", name: "SECRET-clinic", aliases: [], ai_visibility: "visible", is_sensitive: true, updated_at: "2026-09-03" },
      { id: "e-acme", user_id: USER, source_table: "entity", kind: "organization", name: "Acme", aliases: [], ai_visibility: "visible", is_sensitive: false, updated_at: "2026-09-04" },
    ],
    world_events: [],
    // What the old code read: every relationship, hidden people included.
    world_claims: [
      { id: "r-secret", user_id: USER, source_table: "contact_relationship", subject_kind: "contact", subject_id: HIDDEN, attribute: "relationship", value: "SECRET-relationship", updated_at: "2026-09-02" },
    ],
    // What the database leaves after migration 20260929200000.
    agent_world_claims: [
      { id: "c1", user_id: USER, source_table: "claim", subject_kind: "self", subject_id: null, attribute: "current-city", value: "Berlin", updated_at: "2026-09-01" },
    ],
  };
  const fake = fakeClient({
    tables,
    rpcs: {
      godspeed_api_bump_usage: () => ({ data: [{ allowed: true }], error: null }),
      user_today: () => ({ data: "2026-09-30", error: null }),
    },
  });
  const call = async (fn: string, method: string, path: string, body?: Row) => {
    const handler = await loadFunction(fn, fake.client, ENV);
    return handler(new Request(`https://synthetic.invalid/${fn}${path}`, {
      method,
      headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    }));
  };
  const person = (id: string) => tables.contacts.find((c) => c.id === id);
  return { tables, call, person, log: fake.log };
}

describe("mc-api-contacts and people a key may not see", () => {
  it("PUT answers 404 for a hidden, merged-away or another user's person, changes nothing and never echoes a name", async () => {
    const w = await world();
    for (const id of [HIDDEN, MERGED, STRANGER]) {
      const res = await w.call("mc-api-contacts", "PUT", `/${id}`, { name: "Overwritten" });
      expect(res.status).toBe(404);
      expect(await res.text()).not.toContain("SECRET");
      expect(w.person(id)!.name).not.toBe("Overwritten");
    }
  });

  it("a sensitive person is shown redacted but cannot be changed, deleted or logged against", async () => {
    const w = await world();
    expect((await w.call("mc-api-contacts", "PUT", `/${SAM}`, { email: "new@example.invalid" })).status).toBe(403);
    expect(w.person(SAM)!.email).toBe("SECRET-sam@example.invalid");
    expect((await w.call("mc-api-contacts", "DELETE", `/${SAM}`)).status).toBe(403);
    expect(w.person(SAM)).toBeDefined();
    expect((await w.call("mc-api-contacts", "POST", `/${SAM}/interactions`, { type: "call" })).status).toBe(403);
    expect(w.tables.contact_interactions).toEqual([]);
  });

  it("DELETE and a new interaction answer 404 for a hidden person, and touch nothing", async () => {
    const w = await world();
    expect((await w.call("mc-api-contacts", "DELETE", `/${HIDDEN}`)).status).toBe(404);
    expect(w.person(HIDDEN)).toBeDefined();
    expect((await w.call("mc-api-contacts", "POST", `/${HIDDEN}/interactions`, { type: "call" })).status).toBe(404);
    expect(w.tables.contact_interactions).toEqual([]);
  });

  it("a visible person can still be changed, and an interaction is dated in the user's own day", async () => {
    const w = await world();
    expect((await w.call("mc-api-contacts", "PUT", `/${ANNA}`, { company: "Acme" })).status).toBe(200);
    expect(w.person(ANNA)!.company).toBe("Acme");
    expect((await w.call("mc-api-contacts", "POST", `/${ANNA}/interactions`, { type: "call" })).status).toBe(201);
    expect(w.tables.contact_interactions[0]).toMatchObject({ contact_id: ANNA, interaction_date: "2026-09-30" });
  });

  it("the list, the count and a read leave out merged-away and hidden records", async () => {
    const w = await world();
    const list = await (await w.call("mc-api-contacts", "GET", "")).json();
    expect(list.data.map((r: Row) => r.id).sort()).toEqual([ANNA, SAM].sort());
    expect(list.meta.total).toBe(2);
    expect(JSON.stringify(list)).not.toContain("SECRET");
    const status = await (await w.call("mc-api-contacts", "GET", "/sync-status")).json();
    expect(status.data).toEqual({ last_modified: "2026-09-03", contact_count: 2 });
    expect((await w.call("mc-api-contacts", "GET", `/${MERGED}`)).status).toBe(404);
    expect((await w.call("mc-api-contacts", "GET", `/${HIDDEN}`)).status).toBe(404);
  });
});

describe("mc-api-world and people a key may not see", () => {
  it("claims come from agent_world_claims, with no id list in the request", async () => {
    const w = await world();
    const res = await w.call("mc-api-world", "GET", "/claims");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.map((c: Row) => c.id)).toEqual(["c1"]);
    expect(JSON.stringify(body)).not.toContain("SECRET");
  });

  it("a sensitive entity is left out like a sensitive person", async () => {
    const w = await world();
    const body = await (await w.call("mc-api-world", "GET", "/entities")).json();
    expect(body.data.map((e: Row) => e.id).sort()).toEqual([ANNA, "e-acme"].sort());
    expect(JSON.stringify(body)).not.toContain("SECRET");
  });
});
