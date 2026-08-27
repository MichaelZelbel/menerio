/**
 * Shared AI credit enforcement module for all edge functions.
 * Provides balance checks, atomic token deduction, and credit-aware LLM wrappers.
 */

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";

const FALLBACK_TOKENS: Record<string, number> = {
  "deepseek/deepseek-v4-flash": 500,
  "openai/text-embedding-3-small": 100,
  "google/gemini-3-flash-preview": 500,
};

export interface CreditInfo {
  remaining_tokens: number;
  remaining_credits: number;
  tokens_deducted: number;
  tokens_per_credit?: number;
  /**
   * The call cost more than the allowance had left. The provider was already
   * paid, so the true cost is recorded and the balance is landed on exactly
   * zero, which is what makes the next pre-check refuse. See the migration
   * `20260827101500_deduct_ai_tokens_charge_and_land_on_zero.sql`.
   */
  capped?: boolean;
  /** How far the call went past the allowance, in tokens. Only set when capped. */
  overdraft_tokens?: number;
}

/**
 * The balance a call site must have before a provider is contacted.
 *
 * `remaining > 0` was the old bar, and it is what turned an exhausted account
 * into a money pump: with 127 tokens left, every pre-check passed, every call
 * cost thousands, every deduction was refused, and the balance never moved off
 * 127. Requiring a realistic single call's worth means an account close to empty
 * stops before it spends, not after.
 */
export const MIN_CALL_RESERVE_TOKENS = 1_000;

export interface BalanceCheck {
  allowed: boolean;
  remaining_tokens: number;
  remaining_credits: number;
  /**
   * True when the allowance could not be READ at all, as opposed to being read
   * and found empty. Both block the call; only this one is a fault on our side.
   */
  unavailable?: boolean;
  /** The database error text, when `unavailable` is true. */
  error?: string | null;
}

/**
 * Quick pre-check: does the user have any remaining AI credits?
 * Uses the v_ai_allowance_current view (no locking).
 *
 * "I cannot see your allowance" is NOT "you have no credits".
 *
 * This function used to destructure `data` and throw the `error` away, so an RLS
 * block, a missing grant, a PostgREST schema-cache miss or any transient error
 * was indistinguishable from a spent quota: the caller raised
 * INSUFFICIENT_CREDITS and the work was abandoned with nothing in the log saying
 * why. On 2026-08-17 every chunk embedding for one note failed that way while a
 * direct SQL query of the same view showed a healthy balance.
 *
 * The two outcomes are now distinguishable. Both still fail CLOSED, because the
 * alternative leaks a paid provider call per error, and because the problem here
 * was never strictness, it was silence. What changed is that the error is logged
 * with its real code and message, and callers that answer over HTTP can say 503
 * ("I cannot check") instead of 402 ("you are out").
 *
 * Deliberately does not throw: 17 call sites do `if (!balance.allowed)`, several
 * inside background sweeps where an exception would abandon a whole batch rather
 * than skip one optional step. Throwing belongs at {@link openRouterWithCredits},
 * which already runs inside a caller's try/catch.
 *
 * `minTokens` is the bar the balance must clear, defaulting to
 * {@link MIN_CALL_RESERVE_TOKENS}. It used to be "more than nothing", which is
 * how an account with 127 tokens left kept passing while every call it let
 * through cost thousands. Pass a larger figure at a call site that is known to be
 * expensive.
 */
export async function checkBalance(
  db: any,
  userId: string,
  minTokens: number = MIN_CALL_RESERVE_TOKENS
): Promise<BalanceCheck> {
  // Tolerate stray duplicate rows (one per period_start) by ordering and taking the first.
  const { data, error } = await db
    .from("v_ai_allowance_current")
    .select("remaining_tokens, remaining_credits, period_start")
    .eq("user_id", userId)
    .order("period_start", { ascending: false })
    .limit(1);

  if (error) {
    const detail = [error.code, error.message].filter(Boolean).join(" ") || String(error);
    console.error(
      `[llm-credits] allowance lookup FAILED for user=${userId}: ${detail}. ` +
        `This is not an empty balance; the view could not be read.`
    );
    return {
      allowed: false,
      remaining_tokens: 0,
      remaining_credits: 0,
      unavailable: true,
      error: detail,
    };
  }

  const row = Array.isArray(data) && data.length > 0 ? data[0] : null;
  if (!row) {
    console.warn(
      `[llm-credits] no active allowance period for user=${userId} (view readable, zero rows)`
    );
    return { allowed: false, remaining_tokens: 0, remaining_credits: 0 };
  }
  const rt = Number(row.remaining_tokens) || 0;
  const rc = Number(row.remaining_credits) || 0;
  if (rt < minTokens) {
    console.warn(
      `[llm-credits] allowance too low for user=${userId}: ${rt} tokens left, ` +
        `${minTokens} needed before contacting a provider.`
    );
  }
  return { allowed: rt >= minTokens, remaining_tokens: rt, remaining_credits: rc };
}

/**
 * Atomically deduct tokens from the user's active period.
 * Uses FOR UPDATE row lock to prevent race conditions.
 * Throws on insufficient balance or missing period.
 */
export async function deductTokens(
  db: any,
  p: {
    userId: string;
    tokens: number;
    feature: string;
    model?: string;
    provider?: string;
    promptTokens?: number;
    completionTokens?: number;
    idempotencyKey?: string;
    usageSource?: "provider" | "fallback";
  }
): Promise<CreditInfo> {
  const { data, error } = await db.rpc("deduct_ai_tokens", {
    p_user_id: p.userId,
    p_tokens: p.tokens,
    p_feature: p.feature,
    p_model: p.model ?? null,
    p_provider: p.provider ?? "openrouter",
    p_prompt_tokens: p.promptTokens ?? 0,
    p_completion_tokens: p.completionTokens ?? 0,
    p_idempotency_key: p.idempotencyKey ?? null,
    p_usage_source: p.usageSource ?? "unknown",
  });

  if (error) throw new Error(`Token deduction RPC failed: ${error.message}`);

  if (!data.allowed) {
    const err: any = new Error(
      data.error === "insufficient_balance"
        ? "INSUFFICIENT_CREDITS"
        : "NO_ACTIVE_PERIOD"
    );
    err.creditInfo = data;
    throw err;
  }

  if (data.capped) {
    console.warn(
      `[llm-credits] allowance EXHAUSTED by ${p.feature} (user=${p.userId}, ` +
        `model=${p.model}): call cost ${p.tokens} tokens, ` +
        `${data.overdraft_tokens} of them past the allowance. Recorded in full, ` +
        `balance is now zero, further calls are refused until it is topped up.`
    );
  }

  return {
    remaining_tokens: data.remaining_tokens,
    remaining_credits: data.remaining_credits,
    tokens_deducted: data.tokens_deducted,
    tokens_per_credit: data.tokens_per_credit,
    capped: data.capped === true,
    overdraft_tokens: data.overdraft_tokens,
  };
}

/**
 * Call OpenRouter with automatic credit enforcement.
 * 1. Pre-checks balance
 * 2. Makes the LLM call
 * 3. Deducts actual tokens (or fallback estimate)
 * 4. Returns result + credit info
 */
export async function openRouterWithCredits(
  db: any,
  apiKey: string,
  userId: string,
  feature: string,
  endpoint: "chat/completions" | "embeddings",
  body: Record<string, unknown>
): Promise<{ result: any; credits: CreditInfo }> {
  // Pre-check balance
  const balance = await checkBalance(db, userId);
  if (!balance.allowed) {
    const err: any = new Error(
      balance.unavailable ? "BALANCE_UNAVAILABLE" : "INSUFFICIENT_CREDITS"
    );
    err.creditInfo = balance;
    throw err;
  }

  const url = `${OPENROUTER_BASE}/${endpoint}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };

  const r = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!r.ok) {
    const msg = await r.text().catch(() => "");
    throw new Error(`OpenRouter ${endpoint} failed: ${r.status} ${msg}`);
  }

  const result = await r.json();

  // Extract token usage from provider response
  const model = (body.model as string) || "unknown";
  let totalTokens: number;
  let promptTokens = 0;
  let completionTokens = 0;

  let usageSource: "provider" | "fallback";
  if (result.usage) {
    promptTokens = result.usage.prompt_tokens || 0;
    completionTokens = result.usage.completion_tokens || 0;
    totalTokens = result.usage.total_tokens || (promptTokens + completionTokens);
    usageSource = "provider";
  } else {
    // Fallback: use estimated tokens when provider omits usage
    totalTokens = FALLBACK_TOKENS[model] || 300;
    usageSource = "fallback";
    console.warn(`[llm-credits] No usage data from provider for model=${model}, using fallback=${totalTokens}`);
  }

  // Deduct actual tokens
  const credits = await deductTokens(db, {
    userId,
    tokens: totalTokens,
    feature,
    model,
    provider: "openrouter",
    promptTokens,
    completionTokens,
    usageSource,
  });

  return { result, credits };
}

/**
 * Convenience: get an embedding with credits.
 */
export async function getEmbeddingWithCredits(
  db: any,
  apiKey: string,
  userId: string,
  feature: string,
  text: string
): Promise<{ embedding: number[]; credits: CreditInfo }> {
  const { result, credits } = await openRouterWithCredits(
    db, apiKey, userId, `${feature}:embedding`, "embeddings",
    { model: "openai/text-embedding-3-small", input: text }
  );
  return { embedding: result.data[0].embedding, credits };
}

/**
 * Convenience: chat completion with credits.
 */
export async function chatWithCredits(
  db: any,
  apiKey: string,
  userId: string,
  feature: string,
  messages: Array<{ role: string; content: string }>,
  options: Record<string, unknown> = {}
): Promise<{ result: any; credits: CreditInfo }> {
  return openRouterWithCredits(
    db, apiKey, userId, `${feature}:chat`, "chat/completions",
    { model: "deepseek/deepseek-v4-flash", messages, ...options }
  );
}

/**
 * Deduct tokens for a non-OpenRouter LLM call (e.g. Lovable AI Gateway).
 * Call this AFTER the LLM response is received.
 */
export async function deductExternalLLMTokens(
  db: any,
  userId: string,
  feature: string,
  usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number },
  model: string,
  provider = "lovable"
): Promise<CreditInfo> {
  const pt = usage.prompt_tokens || 0;
  const ct = usage.completion_tokens || 0;
  const total = usage.total_tokens || (pt + ct) || FALLBACK_TOKENS[model] || 300;
  const usageSource = (usage.prompt_tokens || usage.completion_tokens || usage.total_tokens) ? "provider" : "fallback";

  if (usageSource === "fallback") {
    console.warn(`[llm-credits] External LLM fallback estimate for model=${model}, tokens=${total}`);
  }

  return deductTokens(db, {
    userId,
    tokens: total,
    feature,
    model,
    provider,
    promptTokens: pt,
    completionTokens: ct,
    usageSource,
  });
}

/**
 * True when a thrown error means "the allowance could not be read", rather than
 * "the allowance was read and it is empty". Keep the two apart at every boundary
 * a human or a retry policy looks at: the first is our fault and worth retrying,
 * the second is a real quota and is not.
 */
export function isBalanceUnavailable(err: unknown): boolean {
  return (err as { message?: string } | null)?.message === "BALANCE_UNAVAILABLE";
}

/**
 * The answer for "I cannot check your balance right now". 503, not 402: nothing
 * is known about the user's quota, so telling them they are out of credits would
 * be a guess presented as a fact.
 */
export function balanceUnavailableResponse(corsHeaders: Record<string, string>) {
  return new Response(
    JSON.stringify({
      error: "Could not verify your AI credit balance. This is a problem on our side, not your quota.",
      code: "BALANCE_UNAVAILABLE",
    }),
    {
      status: 503,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    }
  );
}

/**
 * Build a standard insufficient-credits error response.
 */
export function insufficientCreditsResponse(corsHeaders: Record<string, string>) {
  return new Response(
    JSON.stringify({
      error: "Insufficient AI credits",
      code: "INSUFFICIENT_CREDITS",
    }),
    {
      status: 402,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    }
  );
}
