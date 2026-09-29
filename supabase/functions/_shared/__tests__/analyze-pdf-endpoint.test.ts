import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeDb, loadEndpoint, postJson } from "./edge-harness";

afterEach(() => vi.unstubAllGlobals());

function setup(analyzeMedia: Response) {
  const fetchMock = vi.fn(async () => analyzeMedia);
  vi.stubGlobal("fetch", fetchMock);
  const db = fakeDb();
  const background: Promise<unknown>[] = [];
  const handler = loadEndpoint("supabase/functions/analyze-pdf/index.ts", {
    "https://esm.sh/@supabase/supabase-js@2": { createClient: () => db.client },
  }, { SUPABASE_URL: "https://fixture.invalid", SUPABASE_SERVICE_ROLE_KEY: "fixture-service" },
  { waitUntil: (p) => background.push(p) });
  return { handler, fetchMock, background };
}

const body = { note_id: "11111111-1111-4111-8111-111111111111", storage_path: "someone-else/file.pdf", original_filename: "file.pdf" };

describe("analyze-pdf", () => {
  it("passes on analyze-media's refusal instead of answering 200", async () => {
    const { handler, fetchMock } = setup(new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }));
    const res = await handler(postJson("https://fixture.invalid/analyze-pdf", body));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Forbidden" });
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://fixture.invalid/functions/v1/analyze-media");
    // The caller's own token goes on, so analyze-media checks the caller's ownership.
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer user-token");
    expect(JSON.parse(String(init.body)).media_type).toBe("pdf");
  });

  it("answers 200 when analysis started", async () => {
    const { handler, background } = setup(new Response(JSON.stringify({ ok: true, processing: true }), { status: 200 }));
    const res = await handler(postJson("https://fixture.invalid/analyze-pdf", body));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, processing: true });
    expect(background).toHaveLength(0);
  });
});
