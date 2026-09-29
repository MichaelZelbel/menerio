import { beforeEach, describe, expect, it, vi } from "vitest";

// The loop's only outside dependency is the credit-metered provider call.
const openRouterWithCredits = vi.fn();
vi.mock("../llm-credits.ts", () => ({
  openRouterWithCredits: (...args: unknown[]) => openRouterWithCredits(...args),
}));

import { runAgentLoop } from "../agent-loop.ts";

const toolCallReply = (n: number) => ({
  result: {
    choices: [{
      message: {
        role: "assistant",
        content: null,
        tool_calls: [{ id: `call-${n}`, type: "function", function: { name: "append_to_note", arguments: JSON.stringify({ text: `line ${n}` }) } }],
      },
    }],
  },
  credits: { remaining_tokens: 100, remaining_credits: 1 },
});

const params = (executeTool: (name: string, args: Record<string, unknown>) => Promise<string>) => ({
  db: {},
  apiKey: "fixture-key",
  userId: "fixture-user",
  creditFeature: "note-chat",
  model: "fixture-model",
  systemPrompt: "fixture system prompt",
  chatMessages: [{ role: "user", content: "add five lines" }],
  tools: [],
  executeTool,
  maxIterations: 2,
});

describe("runAgentLoop", () => {
  beforeEach(() => openRouterWithCredits.mockReset());

  it("still reports writes when credits run out on the budget-exhausted synthesis call", async () => {
    // Two rounds of tool calls use up the iteration budget; the synthesis call
    // then finds the allowance empty. The note was already edited twice.
    openRouterWithCredits
      .mockResolvedValueOnce(toolCallReply(1))
      .mockResolvedValueOnce(toolCallReply(2))
      .mockRejectedValueOnce(new Error("INSUFFICIENT_CREDITS"));
    const executeTool = vi.fn(async () => JSON.stringify({ success: true, action: "append_to_note" }));

    const result = await runAgentLoop(params(executeTool));

    expect(executeTool).toHaveBeenCalledTimes(2);
    expect(result.toolResults).toHaveLength(2);
    expect(result.toolResults[0]).toMatchObject({ tool: "append_to_note", result: { success: true } });
    expect(result.reply).toMatch(/stop before finishing/);
  });

  it("still throws INSUFFICIENT_CREDITS when nothing has run yet", async () => {
    openRouterWithCredits.mockRejectedValueOnce(new Error("INSUFFICIENT_CREDITS"));
    const executeTool = vi.fn();
    await expect(runAgentLoop(params(executeTool))).rejects.toThrow("INSUFFICIENT_CREDITS");
    expect(executeTool).not.toHaveBeenCalled();
  });
});
