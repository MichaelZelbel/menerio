import { describe, expect, it, vi } from "vitest";
import { fakeDb, loadEndpoint, postJson } from "./edge-harness";
import { sanitizePromptText } from "../prompt-safety.ts";

const status = (code: number) => () => new Response("{}", { status: code });
const env = { SUPABASE_URL: "https://fixture.invalid", SUPABASE_SERVICE_ROLE_KEY: "fixture-service", SUPABASE_ANON_KEY: "fixture-anon", OPENROUTER_API_KEY: "fixture-key" };

describe("draft-event credit refusals", () => {
  it.each([["BALANCE_UNAVAILABLE", 503], ["REPEAT_CALL_BLOCKED", 429], ["INSUFFICIENT_CREDITS", 402]])("answers %s with %i, not 502", async (code, expected) => {
    const db = fakeDb();
    const handler = loadEndpoint("supabase/functions/draft-event/index.ts", {
      "https://esm.sh/@supabase/supabase-js@2": { createClient: () => db.client },
      "../_shared/llm-credits.ts": {
        openRouterWithCredits: vi.fn(async () => { throw new Error(code); }),
        insufficientCreditsResponse: status(402),
        balanceUnavailableResponse: status(503),
        repeatBlockedResponse: status(429),
      },
      "../_shared/llm-router.ts": { resolveSystemPrompt: async () => "prompt", sourceLanguageRule: () => "" },
      "../_shared/llm-defaults.ts": { DRAFT_EVENT_PROMPT: "fixture" },
      "../_shared/prompt-safety.ts": { sanitizePromptText },
    }, env);
    const res = await handler(postJson("https://fixture.invalid/draft-event", { messages: [{ role: "user", content: "Met Anna" }] }));
    expect(res.status).toBe(expected);
  });
});

describe("weekly-review credit refusals", () => {
  const load = (balance: { allowed: boolean; unavailable?: boolean }) => {
    const db = fakeDb();
    const runChat = vi.fn();
    const handler = loadEndpoint("supabase/functions/weekly-review/index.ts", {
      "https://esm.sh/@supabase/supabase-js@2.47.10": { createClient: () => db.client },
      "../_shared/llm-credits.ts": {
        balanceUnavailableResponse: status(503),
        checkBalance: async () => balance,
        insufficientCreditsResponse: status(402),
      },
      "../_shared/llm-router.ts": { parseModelJson: vi.fn(), runChat, sourceLanguageRule: () => "" },
      "../_shared/llm-defaults.ts": { WEEKLY_REVIEW_PROMPT: "fixture" },
      "../_shared/prompt-safety.ts": { sanitizePromptText },
    }, env);
    return { handler, runChat, db };
  };

  it("answers an unreadable balance with 503, not 'out of credits'", async () => {
    const { handler, runChat, db } = load({ allowed: false, unavailable: true });
    const res = await handler(postJson("https://fixture.invalid/weekly-review", { days: 7 }));
    expect(res.status).toBe(503);
    expect(runChat).not.toHaveBeenCalled();
    expect(db.on("notes")).toHaveLength(0);
  });

  it("still answers an empty allowance with 402", async () => {
    const { handler } = load({ allowed: false });
    const res = await handler(postJson("https://fixture.invalid/weekly-review", { days: 7 }));
    expect(res.status).toBe(402);
  });
});
