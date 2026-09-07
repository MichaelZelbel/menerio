import { beforeEach, describe, expect, it } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CONTACT_TOPIC_SCOPES, registerContactTopicTools } from "../../menerio-mcp/contact-topics-tools";
import { resolveContextPerson, topicContext } from "../contact-topics";

const owner = "00000000-0000-4000-8000-000000000001", person = "00000000-0000-4000-8000-000000000011", topicId = "00000000-0000-4000-8000-000000000021";
let contacts: any[], topics: any[], events: any[], calls: any[], rpcError: any, visible: boolean, scopes: string[];
function fakeDb() {
  return {
    from(table: string) {
      let rows = table === "contacts" ? contacts : table === "contact_topics" ? topics : events;
      let max = 100, single = false;
      const q: any = {
        select: () => q, eq: (key: string, value: unknown) => { rows = rows.filter(r => r[key] === value); return q; },
        is: (key: string, value: unknown) => q.eq(key, value),
        ilike: () => q, or: () => q, order: () => q,
        limit: (n: number) => { max = n; return q; }, range: () => q, maybeSingle: () => { single = true; return q; },
        then: (resolve: (value: unknown) => unknown) => Promise.resolve(resolve({ data: single ? rows[0] ?? null : rows.slice(0, max), count: rows.length, error: null })),
      }; return q;
    },
    async rpc(name: string, args: any) {
      calls.push({ name, args });
      if (name === "ai_can_see") return { data: visible, error: null };
      const current = contacts.find(c => c.id === topics[0]?.contact_id && c.user_id === args.p_user_id);
      if (!current || current.merged_into || current.ai_visibility !== "visible" || current.is_sensitive || !visible) return { data: null, error: { code: "42501", message: "Person not available to AI" } };
      return { data: rpcError ? null : { topic: { ...topics[0], version: 4 }, event_id: topicId, replayed: args.p_request_id.endsWith("99") }, error: rpcError };
    },
  } as any;
}
async function call(name: string, args: Record<string, unknown>) {
  const server = new McpServer({ name: "topics-test", version: "1" });
  const base = server.registerTool.bind(server);
  // Same contacts scope contract as the application's registerTool wrapper.
  (server as any).registerTool = (n: string, meta: any, handler: any) => base(n, meta, async (...a: any[]) => scopes.includes(CONTACT_TOPIC_SCOPES[n]) ? handler(...a) : { isError: true, content: [{ type: "text", text: "Contacts scope required" }] });
  registerContactTopicTools(server, fakeDb(), () => owner);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test", version: "1" });
  await client.connect(clientTransport);
  try { return await client.callTool({ name, arguments: args }); } finally { await client.close(); await server.close(); }
}
const decode = (r: any) => JSON.parse(r.content[0].text);
beforeEach(() => {
  contacts = [{ id: person, user_id: owner, name: "Synthetic Alex", ai_visibility: "visible", is_sensitive: false, merged_into: null }];
  topics = [{ id: topicId, user_id: owner, contact_id: person, title: "Garden", priority: "normal", mode: "recurring", status: "active", version: 3, created_at: "2026-09-01T12:00:00Z" }];
  events = []; calls = []; rpcError = null; visible = true; scopes = ["contacts"];
});
describe("registered topic MCP transport", () => {
  it("lists authoritative topics through SDK validation and transport", async () => {
    const r = decode(await call("list_contact_topics", { contact_id: person }));
    expect(r.topics[0].id).toBe(topicId); expect(r.total).toBe(1); expect(r.person_url).toContain(person);
  });
  it("denies a key without contacts scope before database work", async () => {
    scopes = ["notes"]; expect((await call("list_contact_topics", { contact_id: person })).isError).toBe(true); expect(calls).toEqual([]);
  });
  it.each(["hidden", "sensitive", "foreign", "merged", "rpc-denied"])("refuses direct topic access for %s person", async kind => {
    if (kind === "hidden") contacts[0].ai_visibility = "hidden";
    if (kind === "sensitive") contacts[0].is_sensitive = true;
    if (kind === "foreign") contacts[0].user_id = topicId;
    if (kind === "merged") contacts[0].merged_into = topicId;
    if (kind === "rpc-denied") visible = false;
    const r = await call("archive_contact_topic", { topic_id: topicId, expected_version: 3, request_id: topicId });
    expect(decode(r).error.code).toBe("NOT_ACCESSIBLE");
  });
  it("returns conflict details and never success on database failure", async () => {
    rpcError = { code: "40001", message: "Topic changed", details: '{"current_version":4}' };
    const r = await call("discuss_contact_topic", { topic_id: topicId, expected_version: 3, request_id: topicId });
    expect(r.isError).toBe(true); expect(decode(r).error.code).toBe("VERSION_CONFLICT");
  });
  it("preserves request id, close-after and replay receipt", async () => {
    const request_id = "00000000-0000-4000-8000-000000000099";
    const r = decode(await call("discuss_contact_topic", { topic_id: topicId, expected_version: 3, request_id, close_after: true }));
    expect(r.replayed).toBe(true); expect(calls.find(c => c.name.includes("command")).args).toEqual({ p_user_id: owner, p_request_id: request_id, p_command: { action: "discuss", topic_id: topicId, expected_version: 3, close_after: true } });
  });
  it("rejects invalid UUIDs before touching the database", async () => {
    const r = await call("create_contact_topic", { contact_id: "Alex", title: "Garden", request_id: topicId });
    expect(r.isError).toBe(true); expect(decode(r).error.code).toBe("INVALID_INPUT"); expect(calls).toEqual([]);
  });
  it("refuses a cursor from a different topic list", async () => {
    const cursor = btoa(JSON.stringify({ contact: topicId, status: "active", query: "", priority: "normal", created: "2026-09-01T12:00:00Z", id: topicId }));
    expect(decode(await call("list_contact_topics", { contact_id: person, cursor })).error.code).toBe("INVALID_CURSOR");
  });
  it("uses the shared active section and returns ambiguity for fuzzy names", async () => {
    expect(await topicContext(fakeDb(), owner, person)).toContain("Garden");
    contacts.push({ ...contacts[0], id: topicId });
    expect((await resolveContextPerson(fakeDb(), owner, undefined, "Alex")).error).toBe("AMBIGUOUS_PERSON");
    expect((await resolveContextPerson(fakeDb(), owner, person)).contact.id).toBe(person);
  });
  it("resolves alias-only people and returns duplicate alias candidates", async () => {
    contacts[0].aliases = ["Craft friend"];
    expect((await resolveContextPerson(fakeDb(), owner, undefined, "craft FRIEND")).contact.id).toBe(person);
    contacts.push({ ...contacts[0], id: topicId });
    expect((await resolveContextPerson(fakeDb(), owner, undefined, "Craft friend")).error).toBe("AMBIGUOUS_PERSON");
  });
});
