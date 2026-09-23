import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { extractWikilinkTitles, syncWikilinkConnections, WIKILINK_SOURCE } from "../wikilinks";
import { memoryDb, type MemoryDb, type Row } from "./memory-db";

const USER = "user-a";
const note = (id: string, title: string, over: Row = {}): Row => ({
  id, user_id: USER, title, is_trashed: false, ai_visibility: "visible", source_app: "web",
  created_at: "2026-01-01T00:00:00Z", ...over,
});

let db: MemoryDb;
const links = () => db.tables.note_connections.map((r) => `${r.source_note_id}->${r.target_note_id}:${r.connection_type}`).sort();

beforeEach(() => {
  db = memoryDb({
    notes: [
      note("src", "Trip plan"),
      note("studio", "Ownward Studio"),
      note("berlin", "Berlin"),
    ],
    note_connections: [],
  });
});

describe("extractWikilinkTitles", () => {
  it("reads titles in order, trimmed, once each whatever the case", () => {
    expect(extractWikilinkTitles("See [[Ownward Studio]] and [[ Berlin ]], again [[berlin]].")).toEqual(["Ownward Studio", "Berlin"]);
  });
  it("uses the same pattern as backfill-wikilinks: no brackets or newlines inside", () => {
    expect(extractWikilinkTitles("[[a\nb]] [[]] [[ok]] [single] [[x[y]]")).toEqual(["ok"]);
    const backfill = readFileSync("supabase/functions/backfill-wikilinks/index.ts", "utf8");
    const shared = readFileSync("supabase/functions/_shared/wikilinks.ts", "utf8");
    const pattern = /const WIKILINK_REGEX = (.+);/;
    expect(pattern.exec(shared)?.[1]).toBe(pattern.exec(backfill)?.[1]);
  });
  it("reads the title out of an aliased or heading link", () => {
    expect(extractWikilinkTitles("[[Ownward Studio|the studio]], [[Berlin#History]], [[Paris#^abc123]], [[ownward studio#Team|team]]"))
      .toEqual(["Ownward Studio", "Berlin", "Paris"]);
  });
  it("skips a link to a heading of the same note", () => {
    expect(extractWikilinkTitles("[[#Summary]] and [[|x]]")).toEqual([]);
  });
  it("survives an empty or missing body", () => {
    expect(extractWikilinkTitles("")).toEqual([]);
    expect(extractWikilinkTitles(null)).toEqual([]);
  });
});

describe("syncWikilinkConnections", () => {
  it("writes the manual_link rows the editor would have written", async () => {
    const res = await syncWikilinkConnections(db, USER, "src", "Staying near [[Ownward Studio]] in [[Berlin]].");
    expect(res.added).toBe(2);
    expect(res.linked).toEqual([{ title: "Ownward Studio", note_id: "studio" }, { title: "Berlin", note_id: "berlin" }]);
    expect(links()).toEqual(["src->berlin:manual_link", "src->studio:manual_link"]);
    expect(db.tables.note_connections[0]).toMatchObject({ user_id: USER, strength: 1.0, metadata: { source: WIKILINK_SOURCE } });
  });

  it("matches a title case-insensitively, the way the editor does", async () => {
    const res = await syncWikilinkConnections(db, USER, "src", "[[ownward studio]]");
    expect(res.linked).toEqual([{ title: "ownward studio", note_id: "studio" }]);
  });

  it("does not treat a LIKE wildcard in a title as a wildcard", async () => {
    db.tables.notes.push(note("pct", "100% done"));
    const res = await syncWikilinkConnections(db, USER, "src", "[[100% DONE]] and [[B_rlin]]");
    expect(res.linked).toEqual([{ title: "100% DONE", note_id: "pct" }]);
    expect(res.unresolved).toEqual(["B_rlin"]);
  });

  it("reports a title no note carries and links nothing for it", async () => {
    const res = await syncWikilinkConnections(db, USER, "src", "[[Nowhere]] and [[Berlin]]");
    expect(res.unresolved).toEqual(["Nowhere"]);
    expect(links()).toEqual(["src->berlin:manual_link"]);
  });

  it("never links to a trashed, hidden or foreign note, or to itself", async () => {
    db.tables.notes.push(
      note("binned", "Binned", { is_trashed: true }),
      note("secret", "Secret", { ai_visibility: "hidden" }),
      note("theirs", "Theirs", { user_id: "user-b" }),
    );
    const res = await syncWikilinkConnections(db, USER, "src", "[[Binned]] [[Secret]] [[Theirs]] [[Trip plan]]");
    expect(res.linked).toEqual([]);
    expect(res.unresolved).toEqual(["Binned", "Secret", "Theirs", "Trip plan"]);
    expect(links()).toEqual([]);
  });

  it("resolves a duplicated title to the user's own oldest note, not a mission control file", async () => {
    db.tables.notes.push(
      note("mc-berlin", "Berlin", { source_app: "godspeed", created_at: "2025-01-01T00:00:00Z" }),
      note("berlin-2", "Berlin", { created_at: "2026-06-01T00:00:00Z" }),
    );
    const res = await syncWikilinkConnections(db, USER, "src", "[[Berlin]]");
    expect(res.linked).toEqual([{ title: "Berlin", note_id: "berlin" }]);
  });

  it("is idempotent: a second run adds nothing", async () => {
    await syncWikilinkConnections(db, USER, "src", "[[Berlin]]");
    const again = await syncWikilinkConnections(db, USER, "src", "[[Berlin]]");
    expect(again.added).toBe(0);
    expect(links()).toEqual(["src->berlin:manual_link"]);
  });

  it("removes its own link when the wikilink leaves the body, and nothing else", async () => {
    db.tables.note_connections.push(
      { id: "by-hand", user_id: USER, source_note_id: "src", target_note_id: "studio", connection_type: "manual_link", metadata: {} },
      { id: "semantic", user_id: USER, source_note_id: "src", target_note_id: "berlin", connection_type: "semantic", metadata: {} },
    );
    await syncWikilinkConnections(db, USER, "src", "[[Berlin]]");
    const res = await syncWikilinkConnections(db, USER, "src", "No links any more.");
    expect(res.removed).toBe(1);
    // The link the user drew in the app and the computed one are both still there.
    expect(links()).toEqual(["src->berlin:semantic", "src->studio:manual_link"]);
  });

  it("does not duplicate a link the user already drew by hand", async () => {
    db.tables.note_connections.push({ id: "by-hand", user_id: USER, source_note_id: "src", target_note_id: "berlin", connection_type: "manual_link", metadata: {} });
    const res = await syncWikilinkConnections(db, USER, "src", "[[Berlin]]");
    expect(res.added).toBe(0);
    expect(links()).toEqual(["src->berlin:manual_link"]);
  });
});

describe("where wikilinks become links", () => {
  // The claim the MCP change rests on: before it, nothing server-side did this.
  it("process-note itself writes no manual_link rows", () => {
    const processNote = readFileSync("supabase/functions/process-note/index.ts", "utf8");
    expect(processNote).not.toContain("manual_link");
  });
  it("both MCP write paths call the shared sync", () => {
    expect(readFileSync("supabase/functions/menerio-mcp/note-filing-tools.ts", "utf8")).toContain("syncWikilinkConnections(db, owner, inserted.id, content)");
    expect(readFileSync("supabase/functions/menerio-mcp/index.ts", "utf8")).toContain("syncWikilinkConnections(supabase, getCurrentUserId(), note_id, content)");
  });
});
