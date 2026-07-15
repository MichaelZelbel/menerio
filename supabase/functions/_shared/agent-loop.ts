/**
 * Shared agentic tool loop for the chat agents.
 *
 * Lifted from note-chat's inline loop so note-chat and conversation-chat (Mira)
 * share one implementation: OpenRouter chat/completions with tools, an
 * iteration cap, a budget-exhaustion synthesis pass, and credit accounting.
 *
 * The caller supplies the system prompt, the chat history, the tool schemas,
 * and an `executeTool` closure (which captures whatever the tools need — user
 * id, note id, db, MCP router, etc.). Web search and MCP tools plug in through
 * that same closure, so both agents get them for free.
 *
 * INSUFFICIENT_CREDITS propagates to the caller (map it to your standard
 * insufficient-credits response). All other tool/LLM errors are handled here.
 */
import { openRouterWithCredits } from "./llm-credits.ts";

export interface AgentMessage {
  role: string;
  content?: string | null;
  [k: string]: unknown;
}

export interface RunAgentLoopParams {
  db: any;
  apiKey: string;
  userId: string;
  /** Credit-accounting label, e.g. "note-chat" or "conversation-chat". */
  creditFeature: string;
  model: string;
  systemPrompt: string;
  /** User/assistant history (no system message — this loop adds it). */
  chatMessages: AgentMessage[];
  tools: any[];
  executeTool: (name: string, args: Record<string, unknown>) => Promise<string>;
  maxIterations?: number;
}

export interface RunAgentLoopResult {
  reply: string;
  toolResults: { tool: string; args: unknown; result: unknown }[];
  /** Raw CreditInfo from the last call (caller shapes the response). */
  credits: unknown;
}

const SYNTH_INSTRUCTION =
  "Tool budget exhausted — you cannot call more tools. Using everything gathered above, answer the user's last message directly now. If the gathered results don't contain the answer, say so plainly and suggest what to try instead. Do not claim to have completed any actions.";

const BUDGET_FALLBACK_REPLY =
  "I couldn't finish researching that within my step budget. Try rephrasing, or point me at a specific note or person to look at.";

export async function runAgentLoop(
  p: RunAgentLoopParams
): Promise<RunAgentLoopResult> {
  const maxIterations = p.maxIterations ?? 5;
  const llmMessages: AgentMessage[] = [
    { role: "system", content: p.systemPrompt },
    ...p.chatMessages,
  ];
  const toolResults: { tool: string; args: unknown; result: unknown }[] = [];
  let lastCredits: unknown = null;
  let iterations = 0;

  while (iterations < maxIterations) {
    iterations++;

    const llmResult = await openRouterWithCredits(
      p.db,
      p.apiKey,
      p.userId,
      p.creditFeature,
      "chat/completions",
      { model: p.model, messages: llmMessages, tools: p.tools }
    );
    const result: any = llmResult.result;
    lastCredits = llmResult.credits;

    const choice = result.choices?.[0];
    if (!choice) break;
    const msg = choice.message;

    // No tool calls → final answer.
    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      return { reply: msg.content || "", toolResults, credits: lastCredits };
    }

    // Execute requested tool calls, append results, loop.
    llmMessages.push(msg);
    for (const tc of msg.tool_calls) {
      const fnName = tc.function?.name;
      let fnArgs: Record<string, unknown>;
      try {
        fnArgs = JSON.parse(tc.function?.arguments || "{}");
      } catch {
        fnArgs = {};
      }
      const toolOutput = await p.executeTool(fnName, fnArgs);
      let parsed: unknown;
      try {
        parsed = JSON.parse(toolOutput);
      } catch {
        parsed = toolOutput;
      }
      toolResults.push({ tool: fnName, args: fnArgs, result: parsed });
      llmMessages.push({ role: "tool", tool_call_id: tc.id, content: toolOutput });
    }
  }

  // Iteration budget exhausted while the model still wanted tools. Force one
  // final text answer synthesized from what was gathered — never a canned
  // "actions completed" line.
  try {
    const synth = await openRouterWithCredits(
      p.db,
      p.apiKey,
      p.userId,
      p.creditFeature,
      "chat/completions",
      {
        model: p.model,
        messages: [...llmMessages, { role: "system", content: SYNTH_INSTRUCTION }],
        tools: p.tools,
        tool_choice: "none",
      }
    );
    lastCredits = (synth as any).credits ?? lastCredits;
    const synthReply = (synth as any).result?.choices?.[0]?.message?.content?.trim();
    if (synthReply) return { reply: synthReply, toolResults, credits: lastCredits };
  } catch (err: any) {
    if (err?.message === "INSUFFICIENT_CREDITS") throw err;
    console.error(`[agent-loop] ${p.creditFeature} synthesis error:`, err?.message);
  }

  return { reply: BUDGET_FALLBACK_REPLY, toolResults, credits: lastCredits };
}
