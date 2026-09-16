// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { providerFetch, ProviderTimeoutError } from "../provider-fetch.ts";
import { classifyNoteAIError } from "../note-ai-jobs.ts";
import { runWikiStage } from "../wiki-ingest-jobs.ts";

afterEach(() => vi.unstubAllGlobals());

// A fetch that only ever settles by aborting, the way a hung provider behaves.
function hangingFetch() {
  return vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init.signal?.addEventListener("abort", () => reject(init.signal!.reason));
  }));
}

it("gives every provider call a timeout and names the provider when it fires", async () => {
  const fetchMock = hangingFetch();
  vi.stubGlobal("fetch", fetchMock);
  const error = await providerFetch("LLM call to openrouter.ai", "https://openrouter.ai/x", { method: "POST" }, 20).catch((e) => e);
  expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  expect(error).toBeInstanceOf(ProviderTimeoutError);
  expect(error.message).toBe("LLM call to openrouter.ai timed out after 0s");
  // Not "TimeoutError": the drain worker reserves that name for its own dispatch timeout.
  expect(error.name).not.toBe("TimeoutError");
});

it("classifies a timeout as retryable outside a stage and as uncertain inside a paid one", async () => {
  vi.stubGlobal("fetch", hangingFetch());
  const timeout = await providerFetch("fixture", "https://example.invalid", {}, 10).catch((e) => e);
  expect(classifyNoteAIError(timeout)).toBe("transient");
  const db = { rpc: vi.fn(async (name: string) => ({ data: name === "begin_note_ai_stage" ? { status: "started" } : true, error: null })) };
  const staged = await runWikiStage(db, { user_id: "u", id: "j", lease_id: "l" }, "wiki-main", () => Promise.reject(timeout)).catch((e) => e);
  expect(classifyNoteAIError(staged)).toBe("uncertain");
});

it("keeps a caller's own signal", async () => {
  const fetchMock = vi.fn(async () => new Response("{}"));
  vi.stubGlobal("fetch", fetchMock);
  const own = new AbortController().signal;
  await providerFetch("fixture", "https://example.invalid", { signal: own });
  expect(fetchMock.mock.calls[0][1].signal).toBe(own);
});
