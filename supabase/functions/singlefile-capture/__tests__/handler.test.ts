// @vitest-environment node
//
// Loads the real edge function into a sandbox (same technique as
// merge-contacts/__tests__/handler.test.ts). Key auth, rate limit, storage and
// the database are stand-ins; the SSRF guard, the HTML helpers and folder
// normalisation are the real shared modules.
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";
import { describe, expect, it, vi } from "vitest";
import * as ssrfGuard from "../../_shared/ssrf-guard.ts";
import * as htmlText from "../../_shared/html-text.ts";
import * as noteCreateTools from "../../_shared/note-create-tools.ts";

const source = readFileSync("supabase/functions/singlefile-capture/index.ts", "utf8");
const code = transformSync(source, { loader: "ts", format: "cjs" }).code;

const MB = 1024 * 1024;

/** An image response that streams `totalMb` one-megabyte chunks, counting reads. */
function imageStream(totalMb: number, headers: Record<string, string> = {}) {
  const counter = { pulls: 0 };
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (counter.pulls >= totalMb) return controller.close();
      counter.pulls++;
      controller.enqueue(new Uint8Array(MB));
    },
  });
  return { counter, response: new Response(body, { status: 200, headers: { "content-type": "image/png", ...headers } }) };
}

function setup(imageResponse: () => Response) {
  let handler!: (request: Request) => Promise<Response>;
  const uploads: Array<{ path: string; bytes: number }> = [];
  const notes: Record<string, unknown>[] = [];
  const db = {
    storage: {
      from: () => ({
        upload: async (path: string, bytes: Uint8Array) => (uploads.push({ path, bytes: bytes.byteLength }), { error: null }),
        remove: async () => ({ error: null }),
      }),
    },
    from(table: string) {
      if (table === "note_attachments") return { insert: async () => ({ error: null }) };
      if (table === "notes") {
        return {
          insert(row: Record<string, unknown>) {
            notes.push(row);
            return { select: () => ({ single: async () => ({ data: { id: "note-1", title: row.title }, error: null }) }) };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  const fetch = vi.fn(async (url: string) =>
    String(url).includes("img.example.com") ? imageResponse() : new Response("{}", { status: 202 }));
  const require = (spec: string) => {
    if (spec.includes("supabase-js")) return { createClient: () => db };
    if (spec.includes("mc-auth")) {
      return {
        authenticateGodspeedKey: async () => ({ result: { userId: "u", scopes: ["notes"], keyId: "k" }, error: null }),
        requireScope: () => null,
      };
    }
    if (spec.includes("mc-rate-limit")) return { checkRateLimit: async () => ({ allowed: true }) };
    if (spec.includes("ssrf-guard")) return ssrfGuard;
    if (spec.includes("html-text")) return htmlText;
    if (spec.includes("note-create-tools")) return noteCreateTools;
    throw new Error(`unexpected import in singlefile-capture: ${spec}`);
  };
  runInNewContext(code, {
    require, Request, Response, URL, File, TextEncoder, AbortSignal, RegExp, console, fetch, atob,
    crypto: globalThis.crypto,
    Deno: { env: { get: (k: string) => k }, serve: (fn: typeof handler) => { handler = fn; } },
  });
  const clip = () => {
    const html = '<!doctype html><html><head><title>Big picture</title>' +
      '<meta property="og:image" content="https://img.example.com/hero.png"></head>' +
      "<body><p>Readable text</p></body></html>";
    const form = new FormData();
    form.set("file", new File([html], "page.html", { type: "text/html" }));
    form.set("url", "https://site.example.com/article");
    return handler(new Request("https://example.test/singlefile-capture", {
      method: "POST",
      headers: { Authorization: "Bearer mnr_x" },
      body: form,
    }));
  };
  return { clip, uploads, notes };
}

describe("singlefile-capture hero image", () => {
  it("stops reading an oversized image after the 5 MB cap and still saves the clip", async () => {
    const big = imageStream(64);
    const x = setup(() => big.response);
    const res = await x.clip();
    expect(res.status).toBe(201);
    expect(big.counter.pulls).toBeLessThanOrEqual(7);
    expect(x.uploads).toHaveLength(1); // the snapshot only
    expect(x.notes[0].metadata).toMatchObject({ web_clip: { hero_image_attachment: null } });
  });

  it("does not read an image whose declared length is over the cap", async () => {
    const big = imageStream(64, { "content-length": String(64 * MB) });
    const x = setup(() => big.response);
    expect((await x.clip()).status).toBe(201);
    expect(big.counter.pulls).toBeLessThanOrEqual(1);
    expect(x.uploads).toHaveLength(1);
  });

  it("keeps a hero image under the cap", async () => {
    const small = imageStream(2);
    const x = setup(() => small.response);
    expect((await x.clip()).status).toBe(201);
    expect(x.uploads).toHaveLength(2);
    expect(x.uploads[1].bytes).toBe(2 * MB);
    expect(String(x.notes[0].content)).toContain("![[site-example-com-hero-");
  });
});
