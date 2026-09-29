// @vitest-environment node
import { describe, expect, it } from "vitest";
import { build } from "esbuild";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import { memoryDb, type Row } from "./memory-db";

/**
 * The GitHub sync functions, run as deployed (the real index.ts, bundled),
 * against an in-memory database whose filters are evaluated and an in-memory
 * repository that refuses a PUT or DELETE with a stale sha, as GitHub does.
 *
 * What is pinned: a note never takes over another note's file (same title in
 * the same folder, a failed first export, a trashed note that never synced),
 * a conflict found by a pull is not pushed over, a failed export is retried,
 * an imported note keeps its vault folder, and the people conflict list names
 * only the caller's own contacts.
 */

const USER = "user-a";
const quiet = { ...console, warn: () => {}, error: () => {}, log: () => {} };
const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");

interface GhCall { method: string; path: string }

function fakeGithub(files: Record<string, { text: string; sha?: string }>, opts: { failPut?: boolean; truncated?: boolean } = {}) {
  let n = 0;
  const repo = new Map<string, { text: string; sha: string }>();
  for (const [path, f] of Object.entries(files)) repo.set(path, { text: f.text, sha: f.sha ?? `sha-${path}` });
  const calls: GhCall[] = [];
  const fetch = async (url: string, init: RequestInit = {}) => {
    const method = (init.method || "GET").toUpperCase();
    const u = new URL(String(url));
    if (u.pathname.includes("/git/trees/")) {
      return Response.json({ tree: [...repo].map(([path, f]) => ({ type: "blob", path, sha: f.sha, size: f.text.length })), truncated: Boolean(opts.truncated) });
    }
    const m = u.pathname.match(/^\/repos\/[^/]+\/[^/]+\/contents\/(.+)$/);
    if (m) {
      const path = decodeURIComponent(m[1]);
      calls.push({ method, path });
      const f = repo.get(path);
      if (method === "GET") return f ? Response.json({ content: b64(f.text), sha: f.sha, path }) : new Response("{}", { status: 404 });
      const body = JSON.parse(String(init.body));
      if (method === "PUT") {
        if (opts.failPut) return new Response("Synthetic GitHub outage", { status: 502 });
        if ((f?.sha ?? undefined) !== (body.sha ?? undefined)) return new Response("sha mismatch", { status: 409 });
        const sha = `sha-new-${++n}`;
        repo.set(path, { text: Buffer.from(body.content, "base64").toString("utf8"), sha });
        return Response.json({ content: { sha, path }, commit: { sha: `commit-${n}` } });
      }
      if (method === "DELETE") {
        if (!f || body.sha !== f.sha) return new Response("sha mismatch", { status: 409 });
        repo.delete(path);
        return Response.json({ commit: { sha: `commit-del-${++n}` } });
      }
    }
    return Response.json({ name: "vault", default_branch: "main" });
  };
  return { repo, calls, fetch, writes: () => calls.filter((c) => c.method !== "GET") };
}

async function load(entry: string, tables: Record<string, Row[]>, github: ReturnType<typeof fakeGithub>) {
  const db = memoryDb(tables, {
    github_sync_lease: () => ({ data: true, error: null }),
    get_cron_secret: () => ({ data: "cron-secret", error: null }),
  }) as Row;
  // PostgREST answers with copies. memoryDb hands out its live rows, so a
  // later UPDATE would silently change objects the code under test already
  // holds in its own maps, and hide exactly the stale-map bugs pinned here.
  const liveFrom = db.from.bind(db);
  const copying = (q: Row): Row => new Proxy(q, {
    get(target, prop) {
      if (prop === "then") {
        return (ok: (v: unknown) => unknown, fail?: (e: unknown) => unknown) =>
          target.then((r: Row) => ok(r?.data ? { ...r, data: structuredClone(r.data) } : r), fail);
      }
      const member = target[prop as string];
      return typeof member === "function"
        ? (...args: unknown[]) => { const out = member.apply(target, args); return out === target ? copying(target) : out; }
        : member;
    },
  });
  db.from = (table: string) => copying(liveFrom(table));
  db.auth = {
    getClaims: async (token: string) => token === "user-token"
      ? { data: { claims: { sub: USER } }, error: null }
      : { data: null, error: { message: "invalid token" } },
  };
  db.storage = { from: () => ({ download: async () => ({ data: null, error: { message: "none" } }), upload: async () => ({ error: null }) }) };
  const bundle = await build({
    entryPoints: [`supabase/functions/${entry}/index.ts`], bundle: true, write: false, platform: "node", format: "cjs",
    plugins: [{
      name: "synthetic-database", setup(b) {
        b.onResolve({ filter: /^https:\/\/esm.sh\/@supabase/ }, (args) => ({ path: args.path, namespace: "fake" }));
        b.onLoad({ filter: /.*/, namespace: "fake" }, () => ({ contents: "export const createClient = () => globalThis.testClient", loader: "js" }));
      },
    }],
  });
  let handler: (req: Request) => Promise<Response>;
  vm.runInNewContext(bundle.outputFiles[0].text, {
    testClient: db, console: quiet, Request, Response, URL, Headers, AbortSignal, TextEncoder, TextDecoder, Uint8Array,
    crypto: webcrypto, btoa, atob, setTimeout, clearTimeout, setInterval, clearInterval, fetch: github.fetch,
    Deno: {
      env: { get: (key: string) => ({ SUPABASE_URL: "https://synthetic.invalid", SUPABASE_SERVICE_ROLE_KEY: "service-key", SUPABASE_ANON_KEY: "anon" } as Row)[key] },
      serve: (fn: (req: Request) => Promise<Response>) => { handler = fn; },
    },
  });
  return async (body: Row = {}, authorization = "Bearer user-token") => {
    const res = await handler!(new Request(`https://synthetic.invalid/${entry}`, {
      method: "POST", headers: { Authorization: authorization }, body: JSON.stringify(body),
    }));
    return { status: res.status, body: await res.json() as Row };
  };
}

const connection = (sync_direction: string): Row => ({
  id: "conn-a", user_id: USER, github_token: "gh", repo_owner: "synthetic", repo_name: "vault", branch: "main",
  vault_path: "/", sync_enabled: true, sync_direction, sync_people: false, attachment_folder: "attachments",
});
const note = (id: string, title: string, content: string, updated_at: string): Row => ({
  id, user_id: USER, title, content, folder_path: "", metadata: {}, tags: [], is_trashed: false, source_app: null,
  is_favorite: false, is_pinned: false, entity_type: null, created_at: "2026-09-01T00:00:00Z", updated_at,
});
const log = (id: string, noteId: string, path: string, sha: string | null, synced_at: string, sync_status = "synced"): Row => ({
  id, user_id: USER, note_id: noteId, entity_type: "note", entity_id: noteId, github_path: path, github_sha: sha, sync_status, synced_at,
});
const fileOf = (id: string, body: string) => `---\nid: ${id}\ntitle: "Meeting"\n---\n\n${body}`;

describe("github-sync-pull push step", () => {
  it("does not push over a conflict it found in the same run", async () => {
    const gh = fakeGithub({ "Plan.md": { text: fileOf("n1", "remote edit"), sha: "sha-remote" } });
    const tables = {
      github_connections: [connection("bidirectional")],
      notes: [note("n1", "Plan", "local edit", "2026-09-03T00:00:00Z")],
      github_sync_log: [log("log-1", "n1", "Plan.md", "sha-old", "2026-09-02T00:00:00Z")],
    };
    const invoke = await load("github-sync-pull", tables, gh);
    const r = await invoke();
    expect(r.body.conflicts).toBe(1);
    expect(gh.writes()).toEqual([]);
    expect(gh.repo.get("Plan.md")!.text).toContain("remote edit");
    expect(tables.github_sync_log[0].sync_status).toBe("conflict");
  });

  it("gives two notes with the same title two files", async () => {
    const gh = fakeGithub({});
    const tables = {
      github_connections: [connection("export")],
      notes: [note("n1", "Meeting", "first", "2026-09-03T00:00:00Z"), note("n2", "Meeting", "second", "2026-09-03T00:00:00Z")],
      github_sync_log: [] as Row[],
    };
    const invoke = await load("github-sync-pull", tables, gh);
    expect((await invoke()).status).toBe(200);
    expect(gh.repo.get("Meeting.md")!.text).toContain("first");
    expect(gh.repo.get("Meeting 1.md")!.text).toContain("second");
    const paths = Object.fromEntries(tables.github_sync_log.map((e) => [e.note_id, e.github_path]));
    expect(paths).toEqual({ n1: "Meeting.md", n2: "Meeting 1.md" });
  });

  it("keeps a note at its numbered file instead of moving it onto the other note's", async () => {
    const gh = fakeGithub({
      "Meeting.md": { text: fileOf("n1", "first"), sha: "s1" },
      "Meeting 1.md": { text: fileOf("n2", "second"), sha: "s2" },
    });
    const tables = {
      github_connections: [connection("export")],
      notes: [note("n1", "Meeting", "first", "2026-09-02T00:00:00Z"), note("n2", "Meeting", "second, edited", "2026-09-04T00:00:00Z")],
      github_sync_log: [log("log-1", "n1", "Meeting.md", "s1", "2026-09-03T00:00:00Z"), log("log-2", "n2", "Meeting 1.md", "s2", "2026-09-03T00:00:00Z")],
    };
    const invoke = await load("github-sync-pull", tables, gh);
    expect((await invoke()).status).toBe(200);
    expect(gh.repo.get("Meeting.md")!.text).toContain("first");
    expect(gh.repo.get("Meeting 1.md")!.text).toContain("second, edited");
    expect(gh.calls.some((c) => c.method === "DELETE")).toBe(false);
  });

  it("never pulls another note's file into a note whose first export failed, and retries the export", async () => {
    const gh = fakeGithub({ "Meeting.md": { text: fileOf("n1", "first"), sha: "s1" } });
    const tables = {
      github_connections: [connection("bidirectional")],
      notes: [note("n1", "Meeting", "first", "2026-09-02T00:00:00Z"), note("n2", "Meeting", "mine", "2026-09-04T00:00:00Z")],
      // n2's export failed before it reached GitHub: the path it meant to use, no sha, failure time as synced_at.
      github_sync_log: [log("log-1", "n1", "Meeting.md", "s1", "2026-09-03T00:00:00Z"), log("log-2", "n2", "Meeting.md", null, "2026-09-05T00:00:00Z", "error")],
    };
    const invoke = await load("github-sync-pull", tables, gh);
    expect((await invoke()).status).toBe(200);
    expect(tables.notes.find((n) => n.id === "n2")!.content).toBe("mine");
    expect(gh.repo.get("Meeting.md")!.text).toContain("first");
    expect(gh.repo.get("Meeting 1.md")!.text).toContain("mine");
    const n2Log = tables.github_sync_log.find((e) => e.note_id === "n2")!;
    expect(n2Log).toMatchObject({ github_path: "Meeting 1.md", sync_status: "synced" });
  });
});

describe("github-sync-export", () => {
  it("keeps the entry's path, sha and synced_at when an export fails, so the pull retries it", async () => {
    const gh = fakeGithub({ "Plan.md": { text: fileOf("n1", "old"), sha: "s1" } }, { failPut: true });
    const tables = {
      github_connections: [connection("bidirectional")],
      notes: [note("n1", "Plan", "new", "2026-09-04T00:00:00Z")],
      github_sync_log: [log("log-1", "n1", "Plan.md", "s1", "2026-09-03T00:00:00Z")],
    };
    const invoke = await load("github-sync-export", tables, gh);
    const r = await invoke({ note_id: "n1", action: "update" });
    expect(r.body.success).toBe(false);
    expect(tables.github_sync_log[0]).toMatchObject({ github_path: "Plan.md", github_sha: "s1", synced_at: "2026-09-03T00:00:00Z", sync_status: "error" });
  });

  it("does not push a note that has an open conflict", async () => {
    const gh = fakeGithub({ "Plan.md": { text: fileOf("n1", "remote edit"), sha: "s-remote" } });
    const tables = {
      github_connections: [connection("bidirectional")],
      notes: [note("n1", "Plan", "local edit", "2026-09-04T00:00:00Z")],
      github_sync_log: [log("log-1", "n1", "Plan.md", "s-remote", "2026-09-03T00:00:00Z", "conflict")],
    };
    const invoke = await load("github-sync-export", tables, gh);
    const r = await invoke({ note_id: "n1", action: "update" });
    expect(r.body).toMatchObject({ success: false, conflict: true });
    expect(gh.writes()).toEqual([]);
    expect(tables.github_sync_log[0].sync_status).toBe("conflict");
  });

  it("writes a note whose first export failed to a free path, not over the same-named note", async () => {
    const gh = fakeGithub({ "Meeting.md": { text: fileOf("n1", "first"), sha: "s1" } });
    const tables = {
      github_connections: [connection("bidirectional")],
      notes: [note("n1", "Meeting", "first", "2026-09-02T00:00:00Z"), note("n2", "Meeting", "mine", "2026-09-04T00:00:00Z")],
      github_sync_log: [log("log-1", "n1", "Meeting.md", "s1", "2026-09-03T00:00:00Z"), log("log-2", "n2", "Meeting.md", null, "2026-09-05T00:00:00Z", "error")],
    };
    const invoke = await load("github-sync-export", tables, gh);
    const r = await invoke({ note_id: "n2", action: "update" });
    expect(r.body).toMatchObject({ success: true, path: "Meeting 1.md" });
    expect(gh.repo.get("Meeting.md")!.text).toContain("first");
    expect(gh.calls.some((c) => c.method === "DELETE")).toBe(false);
  });

  it("trashing a note that never reached GitHub leaves the same-named file alone", async () => {
    const gh = fakeGithub({ "Meeting.md": { text: fileOf("n1", "first"), sha: "s1" } });
    const tables = {
      github_connections: [connection("bidirectional")],
      notes: [note("n1", "Meeting", "first", "2026-09-02T00:00:00Z"), note("n2", "Meeting", "draft", "2026-09-04T00:00:00Z")],
      github_sync_log: [log("log-1", "n1", "Meeting.md", "s1", "2026-09-03T00:00:00Z")],
    };
    const invoke = await load("github-sync-export", tables, gh);
    const r = await invoke({ note_id: "n2", action: "delete" });
    expect(r.body.success).toBe(true);
    expect(gh.repo.has("Meeting.md")).toBe(true);
  });

  it("trashing a synced note still deletes its own file", async () => {
    const gh = fakeGithub({ "Meeting.md": { text: fileOf("n1", "first"), sha: "s1" } });
    const tables = {
      github_connections: [connection("bidirectional")],
      notes: [note("n1", "Meeting", "first", "2026-09-02T00:00:00Z")],
      github_sync_log: [log("log-1", "n1", "Meeting.md", "s1", "2026-09-03T00:00:00Z")],
    };
    const invoke = await load("github-sync-export", tables, gh);
    await invoke({ note_id: "n1", action: "delete" });
    expect(gh.repo.has("Meeting.md")).toBe(false);
    expect(tables.github_sync_log).toEqual([]);
  });
});

describe("github-import-vault", () => {
  it("imports a note into its vault folder", async () => {
    const gh = fakeGithub({ "Projects/Idea.md": { text: "Plain body" } });
    const tables = { github_connections: [connection("bidirectional")], notes: [] as Row[], github_sync_log: [] as Row[] };
    const invoke = await load("github-import-vault", tables, gh);
    const r = await invoke({ action: "import", skip_existing: true });
    expect(r.body.imported).toBe(1);
    expect(tables.notes[0]).toMatchObject({ title: "Idea", folder_path: "Projects" });
    expect(tables.github_sync_log[0]).toMatchObject({ github_path: "Projects/Idea.md", note_id: tables.notes[0].id });
  });

  it("leaves out the folders the dialog unticked", async () => {
    const gh = fakeGithub({ "Projects/Idea.md": { text: "keep" }, "Private/Diary.md": { text: "skip" } });
    const tables = { github_connections: [connection("bidirectional")], notes: [] as Row[], github_sync_log: [] as Row[] };
    const invoke = await load("github-import-vault", tables, gh);
    const r = await invoke({ action: "import", skip_existing: true, exclude_folders: ["Private"] });
    expect(r.body.total).toBe(1);
    expect(tables.notes.map((n) => n.title)).toEqual(["Idea"]);
  });

  it("refuses a truncated tree instead of importing part of the vault", async () => {
    const gh = fakeGithub({ "Idea.md": { text: "Plain body" } }, { truncated: true });
    const tables = { github_connections: [connection("bidirectional")], notes: [] as Row[], github_sync_log: [] as Row[] };
    const invoke = await load("github-import-vault", tables, gh);
    const r = await invoke({ action: "import", skip_existing: true });
    expect(r.status).toBe(500);
    expect(tables.notes).toEqual([]);
  });
});

describe("github-people-sync get-conflicts", () => {
  it("names only the caller's own contacts", async () => {
    const tables = {
      github_connections: [connection("bidirectional")],
      contacts: [{ id: "c-other", user_id: "user-b", name: "Someone Else" }],
      contact_groups: [] as Row[],
      github_sync_log: [{ id: "log-p", user_id: USER, note_id: null, entity_type: "person", entity_id: "c-other", github_path: "People/x.md", sync_status: "conflict" }],
    };
    const invoke = await load("github-people-sync", tables, fakeGithub({}));
    const r = await invoke({ action: "get-conflicts" });
    expect(r.body.conflicts).toHaveLength(1);
    expect(r.body.conflicts[0].name).toBe("People/x.md");
  });
});

describe("github-sync-scheduled", () => {
  it("compares the service key by digest, not with ===", () => {
    const src = readFileSync("supabase/functions/github-sync-scheduled/index.ts", "utf8");
    expect(src).not.toMatch(/authorization === `Bearer/);
    expect(src).toMatch(/secretEquals\(bearer, serviceKey\)/);
  });

  it("runs for the service key and refuses a near miss", async () => {
    const tables = { github_connections: [] as Row[] };
    const invoke = await load("github-sync-scheduled", tables, fakeGithub({}));
    expect((await invoke({}, "Bearer service-key")).status).toBe(200);
    expect((await invoke({}, "Bearer service-kez")).status).toBe(401);
  });
});
