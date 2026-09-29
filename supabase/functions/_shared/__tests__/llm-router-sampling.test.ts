// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";
import { modelRejectsSampling, runChat } from "../llm-router.ts";

afterEach(() => vi.unstubAllGlobals());

/**
 * Claude models from Opus 4.7 and Sonnet 5 on answer 400 to temperature,
 * top_p and top_k. The router sent a call site's temperature to every model,
 * so no call site with one (several defaults set 0 to 0.2) could run on a
 * current Claude model, and generate_collection_schema could not leave the
 * deprecated claude-sonnet-4-20250514.
 */
describe("modelRejectsSampling", () => {
  it.each([
    ["claude-sonnet-5", true],
    ["claude-opus-5", true],
    ["claude-opus-5-5", true],
    ["claude-opus-4-7", true],
    ["claude-opus-4-8", true],
    ["claude-fable-5-1", true],
    ["anthropic/claude-sonnet-5", true],
    ["anthropic/claude-opus-4.7", true],
    ["claude-opus-4-6", false],
    ["claude-sonnet-4-6", false],
    ["anthropic/claude-sonnet-4.6", false],
    ["claude-haiku-4-5", false],
    ["claude-haiku-4-5-20251001", false],
    ["claude-sonnet-4-20250514", false],
    ["claude-opus-4-20250514", false],
    ["claude-opus-4-1-20250805", false],
    ["claude-3-5-sonnet-20241022", false],
    ["deepseek/deepseek-v4-flash", false],
    ["ministral-14b-2512", false],
    ["", false],
  ])("%s -> %s", (model, expected) => {
    expect(modelRejectsSampling(model)).toBe(expected);
  });
});

/** A database that has no config row, a balance, and records deductions. */
function db() {
  const query: Record<string, unknown> = {};
  for (const m of ["select", "eq", "order"]) query[m] = () => query;
  query.limit = async () => ({ data: [{ remaining_tokens: 10000, remaining_credits: 50 }] });
  query.maybeSingle = async () => ({ data: null });
  return {
    from: () => query,
    rpc: async (name: string) =>
      name === "llm_note_call_fingerprint"
        ? { data: { allowed: true } }
        : { data: { allowed: true, tokens_deducted: 1, remaining_tokens: 9000, remaining_credits: 45 } },
  };
}

async function sentBody(provider: "anthropic" | "openrouter", model: string, callSite: string) {
  vi.stubGlobal("Deno", { env: { get: () => "synthetic-test-key" } });
  const reply = provider === "anthropic"
    ? { content: [{ type: "text", text: "ok" }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } }
    : { choices: [{ message: { content: "ok" }, finish_reason: "stop" }], usage: { total_tokens: 2 } };
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(reply)));
  vi.stubGlobal("fetch", fetchMock);
  await runChat({
    db: db(),
    userId: "user-a",
    callSite,
    messages: [{ role: "user", content: "hi" }],
    defaults: { provider, model, temperature: 0.2 },
    callOptions: { top_p: 0.9 },
  });
  return JSON.parse(fetchMock.mock.calls[0][1].body);
}

describe("runChat sampling parameters", () => {
  it("drops temperature for Claude Sonnet 5 on the Anthropic API", async () => {
    const body = await sentBody("anthropic", "claude-sonnet-5", "sampling-a");
    expect(body.model).toBe("claude-sonnet-5");
    expect(body).not.toHaveProperty("temperature");
  });

  it("keeps temperature for Claude Haiku 4.5", async () => {
    const body = await sentBody("anthropic", "claude-haiku-4-5", "sampling-b");
    expect(body.temperature).toBe(0.2);
  });

  it("drops temperature and top_p for a current Claude model through OpenRouter", async () => {
    const body = await sentBody("openrouter", "anthropic/claude-opus-5-5", "sampling-c");
    expect(body).not.toHaveProperty("temperature");
    expect(body).not.toHaveProperty("top_p");
  });

  it("leaves other models' sampling parameters alone", async () => {
    const body = await sentBody("openrouter", "deepseek/deepseek-v4-flash", "sampling-d");
    expect(body.temperature).toBe(0.2);
    expect(body.top_p).toBe(0.9);
  });
});
