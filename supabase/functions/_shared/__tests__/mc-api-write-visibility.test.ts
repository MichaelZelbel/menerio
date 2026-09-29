// @vitest-environment node
import { describe, expect, it } from "vitest";
import { sha256Hex } from "../sha256.ts";
import { fakeClient, loadFunction, type Row } from "./entrypoint-harness";

/**
 * "Hidden from AI" for a Mission Control key covers writes as well as reads,
 * the same rule MCP's update_note / trash_note apply: a key must not change,
 * or learn through a write's answer, a note or action item it may not read.
 * And the sensitive-person gate has to recognise matched_people in the shape
 * process-note actually stores: objects carrying contact_id.
 */

const KEY = "mnr_" + "d".repeat(48);
const USER = "00000000-0000-4000-8000-00000000000a";
const SAM = "00000000-0000-4000-8000-0000000000c5"; // marked sensitive
const VISIBLE = "00000000-0000-4000-8000-000000000001";
const HIDDEN = "00000000-0000-4000-8000-000000000002";
const ABOUT_SAM = "00000000-0000-4000-8000-000000000003";
const ENV = { SUPABASE_URL: "https://synthetic.invalid", SUPABASE_SERVICE_ROLE_KEY: "service-key", OPENROUTER_API_KEY: "provider-key" };

async function world() {
  const tables: Record<string, Row[]> = {
    godspeed_api_keys: [{ id: "key-1", user_id: USER, key_hash: await sha256Hex(KEY), scopes: ["notes", "actions", "stats"], is_active: true, expires_at: null, godspeed_connection_id: null, generation: null }],
    contacts: [
      { id: SAM, user_id: USER, name: "Sam", is_sensitive: true, merged_into: null, ai_visibility: "visible" },
    ],
    notes: [
      { id: VISIBLE, user_id: USER, title: "Groceries", content: "milk", tags: ["home"], is_trashed: false, ai_visibility: "visible", metadata: {}, updated_at: "2026-09-01" },
      { id: HIDDEN, user_id: USER, title: "Diagnosis", content: "private", tags: ["secret-tag"], is_trashed: false, ai_visibility: "hidden", metadata: {}, updated_at: "2026-09-02" },
      {
        id: ABOUT_SAM, user_id: USER, title: "Sam's court date", content: "details", tags: ["home"], is_trashed: false, ai_visibility: "visible", updated_at: "2026-09-03",
        metadata: { matched_people: [{ name: "Me", is_self: true, canonical_name: "Me" }, { name: "Sam", contact_id: SAM, canonical_name: "Sam" }] },
      },
    ],
    action_items: [
      { id: VISIBLE, user_id: USER, content: "Buy milk", status: "open", priority: "normal", ai_visibility: "visible", contact_id: null, updated_at: "2026-09-01" },
      { id: HIDDEN, user_id: USER, content: "Call the clinic", status: "open", priority: "normal", ai_visibility: "hidden", contact_id: null, updated_at: "2026-09-02" },
      { id: ABOUT_SAM, user_id: USER, content: "Visit Sam in prison", status: "open", priority: "normal", ai_visibility: "visible", contact_id: SAM, updated_at: "2026-09-03" },
    ],
  };
  const fake = fakeClient({ tables, rpcs: { godspeed_api_bump_usage: () => ({ data: [{ allowed: true }], error: null }) } });
  const call = async (fn: string, method: string, path: string, body?: Row) => {
    const handler = await loadFunction(fn, fake.client, ENV);
    return handler(new Request(`https://synthetic.invalid/${fn}${path}`, {
      method,
      headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    }));
  };
  const note = (id: string) => tables.notes.find((n) => n.id === id)!;
  const item = (id: string) => tables.action_items.find((a) => a.id === id)!;
  return { tables, call, note, item };
}

describe("mc-api-notes and a note hidden from the key", () => {
  it("reads a note about a sensitive person as not there, with matched_people in its stored shape", async () => {
    const w = await world();
    expect((await w.call("mc-api-notes", "GET", `/${ABOUT_SAM}`)).status).toBe(404);
    const list = await (await w.call("mc-api-notes", "GET", "")).json();
    expect(list.data.map((r: Row) => r.id)).toEqual([VISIBLE]);
  });

  it("PUT answers 404 for a hidden note, changes nothing and never echoes its title", async () => {
    const w = await world();
    const res = await w.call("mc-api-notes", "PUT", `/${HIDDEN}`, { content: "overwritten" });
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain("Diagnosis");
    expect(w.note(HIDDEN).content).toBe("private");
  });

  it("PUT cannot strip matched_people off a note about a sensitive person to make it readable", async () => {
    const w = await world();
    expect((await w.call("mc-api-notes", "PUT", `/${ABOUT_SAM}`, { metadata: {} })).status).toBe(404);
    expect(w.note(ABOUT_SAM).metadata.matched_people).toHaveLength(2);
    expect((await w.call("mc-api-notes", "GET", `/${ABOUT_SAM}`)).status).toBe(404);
  });

  it("DELETE answers 404 for a hidden or sensitive note and leaves both out of the bin", async () => {
    const w = await world();
    expect((await w.call("mc-api-notes", "DELETE", `/${HIDDEN}`)).status).toBe(404);
    expect((await w.call("mc-api-notes", "DELETE", `/${ABOUT_SAM}`)).status).toBe(404);
    expect(w.note(HIDDEN).is_trashed).toBe(false);
    expect(w.note(ABOUT_SAM).is_trashed).toBe(false);
  });

  it("still edits and trashes a note the key can see", async () => {
    const w = await world();
    expect((await w.call("mc-api-notes", "PUT", `/${VISIBLE}`, { content: "oat milk" })).status).toBe(200);
    expect(w.note(VISIBLE).content).toBe("oat milk");
    expect((await w.call("mc-api-notes", "DELETE", `/${VISIBLE}`)).status).toBe(200);
    expect(w.note(VISIBLE).is_trashed).toBe(true);
  });
});

describe("mc-api-actions PUT and an item hidden from the key", () => {
  it("answers 404 for a hidden item without its content, and changes nothing", async () => {
    const w = await world();
    const res = await w.call("mc-api-actions", "PUT", `/${HIDDEN}`, { status: "done" });
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain("clinic");
    expect(w.item(HIDDEN).status).toBe("open");
  });

  it("cannot unlink the sensitive person to make the item readable", async () => {
    const w = await world();
    expect((await w.call("mc-api-actions", "PUT", `/${ABOUT_SAM}`, { contact_id: null })).status).toBe(404);
    expect(w.item(ABOUT_SAM).contact_id).toBe(SAM);
  });

  it("still updates an item the key can see", async () => {
    const w = await world();
    const res = await w.call("mc-api-actions", "PUT", `/${VISIBLE}`, { status: "done" });
    expect(res.status).toBe(200);
    expect(w.item(VISIBLE).status).toBe("done");
    expect(w.item(VISIBLE).completed_at).toBeTruthy();
  });
});

describe("mc-api-stats overview", () => {
  it("counts and tags only what the key may see", async () => {
    const w = await world();
    const res = await w.call("mc-api-stats", "GET", "/overview");
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.top_tags.map((t: Row) => t.tag)).not.toContain("secret-tag");
    expect(data.note_count).toBe(2);
    expect(data.open_action_count).toBe(2);
  });
});
