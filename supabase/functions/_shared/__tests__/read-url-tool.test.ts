import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MAX_FETCHES_PER_TURN,
  createUrlReadSession,
  isYouTubeUrl,
  runReadUrl,
} from "../read-url-tool.ts";

// jsdom's AbortSignal has no `timeout` helper, which `safeFetchText` uses. The
// Deno edge runtime does, so this is a test-environment gap, not a production
// one. Polyfill it rather than weakening the fetch path.
if (typeof (AbortSignal as unknown as { timeout?: unknown }).timeout !== "function") {
  (AbortSignal as unknown as { timeout: (ms: number) => AbortSignal }).timeout = (
    ms: number,
  ) => {
    const c = new AbortController();
    setTimeout(() => c.abort(), ms);
    return c.signal;
  };
}

/** Stub global fetch with a single HTML response. */
function stubPage(html: string, init: ResponseInit = {}) {
  const spy = vi.fn(async () => new Response(html, { status: 200, ...init }));
  vi.stubGlobal("fetch", spy);
  return spy;
}

function longArticle(): string {
  const para = "This is a sentence of ordinary article prose that carries meaning. ";
  return `<html><head><title>An Article</title>
    <meta name="description" content="A short summary."></head>
    <body><article><p>${para.repeat(30)}</p></article></body></html>`;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("isYouTubeUrl", () => {
  it("recognises the watch and short forms", () => {
    expect(isYouTubeUrl("https://www.youtube.com/watch?v=abc")).toBe(true);
    expect(isYouTubeUrl("https://youtu.be/abc")).toBe(true);
    expect(isYouTubeUrl("https://m.youtube.com/watch?v=abc")).toBe(true);
  });

  it("does not match unrelated or lookalike hosts", () => {
    expect(isYouTubeUrl("https://example.com/youtube.com")).toBe(false);
    expect(isYouTubeUrl("https://notyoutube.com/watch")).toBe(false);
    expect(isYouTubeUrl("not a url")).toBe(false);
  });
});

describe("runReadUrl: YouTube", () => {
  it("refuses without spending a fetch, and says how to get the transcript", async () => {
    const spy = stubPage("<html></html>");
    const session = createUrlReadSession();
    const res = JSON.parse(
      await runReadUrl(session, "https://www.youtube.com/watch?v=abc"),
    );

    expect(res.error).toBe("youtube_unsupported");
    expect(res.message).toContain("Show transcript");
    expect(spy).not.toHaveBeenCalled();
    expect(session.fetches).toBe(0);
  });
});

describe("runReadUrl: ordinary pages", () => {
  it("returns the page text wrapped as untrusted content", async () => {
    stubPage(longArticle());
    const res = JSON.parse(
      await runReadUrl(createUrlReadSession(), "https://example.com/a"),
    );

    expect(res.ok).toBe(true);
    expect(res.title).toBe("An Article");
    expect(res.description).toBe("A short summary.");
    expect(res.content).toContain("UNTRUSTED CONTENT");
    expect(res.content).toContain("ordinary article prose");
  });

  it("says it could not read a page that renders client-side", async () => {
    stubPage('<html><head><title>App</title></head><body><div id="root"></div></body></html>');
    const res = JSON.parse(
      await runReadUrl(createUrlReadSession(), "https://example.com/spa"),
    );

    expect(res.error).toBe("no_readable_content");
    expect(res.message).toContain("do not infer");
  });

  it("reports a refused URL rather than pretending it read one", async () => {
    const res = JSON.parse(
      await runReadUrl(createUrlReadSession(), "http://169.254.169.254/latest/meta-data/"),
    );
    expect(res.error).toBe("fetch_failed");
    expect(res.message).toContain("public https");
  });

  it("caches a URL within one turn instead of refetching", async () => {
    const spy = stubPage(longArticle());
    const session = createUrlReadSession();
    await runReadUrl(session, "https://example.com/a");
    await runReadUrl(session, "https://example.com/a");
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("stops at the per-turn fetch cap", async () => {
    const session = createUrlReadSession();
    session.fetches = MAX_FETCHES_PER_TURN;
    const spy = stubPage(longArticle());
    const res = JSON.parse(await runReadUrl(session, "https://example.com/new"));
    expect(res.error).toBe("limit_reached");
    expect(spy).not.toHaveBeenCalled();
  });

  it("requires a url", async () => {
    const res = JSON.parse(await runReadUrl(createUrlReadSession(), "  "));
    expect(res.error).toBe("url required");
  });
});
