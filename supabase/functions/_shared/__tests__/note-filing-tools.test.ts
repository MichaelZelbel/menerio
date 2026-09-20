import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { registerNoteFilingTools, type NoteFilingDeps } from "../../menerio-mcp/note-filing-tools";
import type { ChunkEmbedResult } from "../chunk-embeddings";
import { memoryDb, type MemoryDb, type Row } from "./memory-db";

/**
 * capture_note and list_note_folders through the MCP SDK's own validation and
 * transport, the way contact-topics-tools is tested: the real registration, a
 * database whose filters are evaluated, and the three runtime calls stubbed.
 */
const USER = "00000000-0000-4000-8000-000000000001";
const VECTOR = [0.1, 0.2, 0.3];

let db: MemoryDb;
let processed: string[];
let metadataCalls: number;
let embedResult: Partial<ChunkEmbedResult>;

const embedded = (over: Partial<ChunkEmbedResult> = {}): ChunkEmbedResult => ({
  chunkCount: 1, attempted: 1, replaced: true, truncated: false, failures: 0, firstChunkEmbedding: VECTOR, ...over,
});

const note = (id: string, title: string, over: Row = {}): Row => ({
  id, user_id: USER, title, content: "", is_trashed: false, ai_visibility: "visible", source_app: "web",
  folder_path: "", created_at: "2026-01-01T00:00:00Z", ...over,
});

function deps(): NoteFilingDeps {
  return {
    extractMetadata: async () => { metadataCalls += 1; return { type: "reference", topics: ["health", "labs"], people: ["Dr. Synthetic"] }; },
    embedChunks: async () => embedded(embedResult),
    triggerProcessNote: (id) => { processed.push(id); },
  };
}

async function call(name: string, args: Record<string, unknown>) {
  const server = new McpServer({ name: "filing-test", version: "1" });
  registerNoteFilingTools(server, db, () => USER, deps());
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test", version: "1" });
  await client.connect(clientTransport);
  try { return await client.callTool({ name, arguments: args }) as { isError?: boolean; content: { text: string }[] }; }
  finally { await client.close(); await server.close(); }
}
const textOf = (r: { content: { text: string }[] }) => r.content[0].text;

beforeEach(() => {
  processed = []; metadataCalls = 0; embedResult = {};
  db = memoryDb(
    {
      notes: [
        note("n-chol", "Cholesterol", { folder_path: "Health" }),
        note("n-hub", "observations/health.md", { source_app: "hub", source_id: "observations/health.md", folder_path: "hub/observations" }),
        note("n-binned", "Old labs", { is_trashed: true, folder_path: "Health" }),
        note("n-top", "Loose thought"),
      ],
      note_folders: [{ id: "f1", user_id: USER, path: "Health", name: "Health", parent_path: "" }, { id: "f2", user_id: USER, path: "hub", name: "hub", parent_path: "" }],
      note_connections: [],
    },
    {
      match_note_chunks: () => ({ data: [
        { note_id: "n-hub", similarity: 0.80 }, { note_id: "n-chol", similarity: 0.72 }, { note_id: "n-binned", similarity: 0.9 },
      ], error: null }),
    },
  );
});

describe("capture_note", () => {
  it("files the note: given title, existing folder matched by case, merged tags", async () => {
    const r = await call("capture_note", { content: "LDL 130, see [[Cholesterol]].", title: "Blood test March", folder_path: "/health/", tags: ["Labs"] });
    expect(r.isError).toBeFalsy();
    const saved = db.tables.notes.find((n) => n.title === "Blood test March")!;
    expect(saved).toMatchObject({ user_id: USER, folder_path: "Health", tags: ["Labs", "health"], embedding: VECTOR });
    expect(saved.metadata).toMatchObject({ source: "mcp", type: "reference" });

    const t = textOf(r);
    expect(t).toContain(`ID: ${saved.id}`);
    expect(t).toContain("Title: Blood test March");
    expect(t).toContain("Folder: Health");
    expect(t).toContain("Menerio links related notes on its own in the background");
    expect(processed).toEqual([saved.id]);
  });

  it("still works with content alone: first line as title, top level", async () => {
    const r = await call("capture_note", { content: "Just a thought\nmore" });
    const saved = db.tables.notes.find((n) => n.title === "Just a thought")!;
    expect(saved.folder_path).toBe("");
    expect(saved.tags).toEqual(["health", "labs"]);
    expect(textOf(r)).toContain("Folder: top level");
  });

  it("creates a folder that does not exist yet, every segment of it", async () => {
    const r = await call("capture_note", { content: "x", title: "Invoice", folder_path: "Money/Invoices" });
    expect(db.tables.note_folders.map((f) => f.path)).toEqual(expect.arrayContaining(["Money", "Money/Invoices"]));
    expect(db.tables.note_folders.find((f) => f.path === "Money/Invoices")).toMatchObject({ user_id: USER, name: "Invoices", parent_path: "Money" });
    expect(textOf(r)).toContain("Folder: Money/Invoices (new folder created: Money, Money/Invoices)");
  });

  it.each(["hub", "hub/rules", "/Hub/observations/", "HUB\\x"])("refuses folder_path %s before spending or saving anything", async (folder_path) => {
    const before = db.tables.notes.length;
    const r = await call("capture_note", { content: "x", folder_path });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain("mirror of the user's hub files");
    expect(textOf(r)).toContain("Nothing was saved");
    expect(db.tables.notes).toHaveLength(before);
    expect(metadataCalls).toBe(0);
    expect(processed).toEqual([]);
  });

  it("does not mistake a look-alike folder for the mirror", async () => {
    const r = await call("capture_note", { content: "x", folder_path: "Hubris" });
    expect(r.isError).toBeFalsy();
    expect(textOf(r)).toContain("Folder: Hubris");
  });

  it("lists related existing notes: native first, hub file marked, trashed and itself left out", async () => {
    const t = textOf(await call("capture_note", { content: "LDL 130", title: "Blood test" }));
    const related = t.split("\n").filter((l) => l.startsWith("- "));
    expect(related).toEqual([
      "- Cholesterol (n-chol), 72% similar",
      "- observations/health.md [hub file] (n-hub), 80% similar",
    ]);
    const saved = db.tables.notes.find((n) => n.title === "Blood test")!;
    expect(db.rpcCalls[0].args).toMatchObject({ p_user_id: USER, query_embedding: VECTOR });
    expect(t).not.toContain(`- Blood test (${saved.id})`);
  });

  it("says indexing was deferred for lack of credits, returns no list, and still saves", async () => {
    embedResult = { chunkCount: 0, replaced: false, firstChunkEmbedding: null, insufficientCredits: true };
    const t = textOf(await call("capture_note", { content: "x", title: "No credits" }));
    expect(t).toContain("out of AI credits");
    expect(t.split("\n").filter((l) => l.startsWith("- "))).toEqual([]);
    expect(db.rpcCalls).toEqual([]);
    const saved = db.tables.notes.find((n) => n.title === "No credits")!;
    expect(saved.embedding).toBeUndefined();
    expect(processed).toEqual([saved.id]);
  });

  it("turns [[Exact Title]] in the body into manual_link rows and reports them", async () => {
    const t = textOf(await call("capture_note", { content: "Compare with [[cholesterol]] and [[Nowhere]].", title: "Blood test" }));
    const saved = db.tables.notes.find((n) => n.title === "Blood test")!;
    expect(db.tables.note_connections).toEqual([
      expect.objectContaining({ user_id: USER, source_note_id: saved.id, target_note_id: "n-chol", connection_type: "manual_link", strength: 1.0 }),
    ]);
    expect(t).toContain("cholesterol (n-chol)");
    expect(t).toContain("Nowhere");
  });

  it("keeps the deprecated alias working on the same handler", async () => {
    const r = await call("capture_thought", { content: "Alias note" });
    expect(r.isError).toBeFalsy();
    expect(db.tables.notes.some((n) => n.title === "Alias note")).toBe(true);
  });

  it("tells a model about title, folder, tags and wikilinks in its description", async () => {
    const server = new McpServer({ name: "filing-test", version: "1" });
    registerNoteFilingTools(server, db, () => USER, deps());
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    const client = new Client({ name: "test", version: "1" });
    await client.connect(ct);
    const tools = (await client.listTools()).tools;
    await client.close(); await server.close();
    const capture = tools.find((t) => t.name === "capture_note")!;
    for (const word of ["`title`", "`folder_path`", "`tags`", "list_note_folders", "[[Exact Title]]", "hub"]) expect(capture.description).toContain(word);
    expect(Object.keys((capture.inputSchema as { properties: Row }).properties).sort()).toEqual(["content", "folder_path", "tags", "title"]);
    expect((capture.inputSchema as { required?: string[] }).required).toEqual(["content"]);
  });
});

describe("list_note_folders", () => {
  it("lists folders with counts and the top-level count, hub mirror hidden, trash not counted", async () => {
    const out = JSON.parse(textOf(await call("list_note_folders", {})));
    expect(out.folders).toEqual([{ path: "Health", notes: 1, notes_including_subfolders: 1 }]);
    expect(out.top_level_notes).toBe(1);
    expect(out.hub_mirror_included).toBe(false);
  });

  it("shows the mirror tree when include_hub is true", async () => {
    const out = JSON.parse(textOf(await call("list_note_folders", { include_hub: true })));
    expect(out.folders.map((f: Row) => f.path)).toEqual(["Health", "hub", "hub/observations"]);
    expect(out.folders.find((f: Row) => f.path === "hub/observations").notes).toBe(1);
  });

  it("counts only the caller's notes and leaves AI-hidden ones out", async () => {
    db.tables.notes.push(note("theirs", "x", { user_id: "user-b", folder_path: "Theirs" }), note("secret", "y", { ai_visibility: "hidden", folder_path: "Private" }));
    const out = JSON.parse(textOf(await call("list_note_folders", {})));
    expect(out.folders.map((f: Row) => f.path)).toEqual(["Health"]);
  });
});

describe("registration in the MCP server", () => {
  const index = readFileSync("supabase/functions/menerio-mcp/index.ts", "utf8");
  it("gates the new tool with the notes scope, where every tool is gated", () => {
    const scopes = index.slice(index.indexOf("const TOOL_SCOPES"), index.indexOf("function scopeRefusal"));
    for (const tool of ["capture_note", "capture_thought", "list_note_folders"]) expect(scopes).toMatch(new RegExp(`\\b${tool}: "notes"`));
  });
  it("registers the filing tools after the scope wrapper is installed", () => {
    expect(index.indexOf("registerNoteFilingTools(server, supabase, getCurrentUserId")).toBeGreaterThan(index.indexOf("(server as any).registerTool ="));
  });
});
