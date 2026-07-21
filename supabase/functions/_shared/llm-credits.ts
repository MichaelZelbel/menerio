/**
 * Shared AI credit enforcement module for all edge functions.
 * Provides balance checks, atomic token deduction, and credit-aware LLM wrappers.
 */

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
const LOVABLE_GATEWAY_BASE = "https://ai.gateway.lovable.dev/v1";
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY") || "";

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
}

export interface BalanceCheck {
  allowed: boolean;
  remaining_tokens: number;
  remaining_credits: number;
}

/**
 * Quick pre-check: does the user have any remaining AI credits?
 * Uses the v_ai_allowance_current view (no locking).
 */
export async function checkBalance(
  db: any,
  userId: string
): Promise<BalanceCheck> {
  // Tolerate stray duplicate rows (one per period_start) by ordering and taking the first.
  const { data } = await db
    .from("v_ai_allowance_current")
    .select("remaining_tokens, remaining_credits, period_start")
    .eq("user_id", userId)
    .order("period_start", { ascending: false })
    .limit(1);

  const row = Array.isArray(data) && data.length > 0 ? data[0] : null;
  if (!row) return { allowed: false, remaining_tokens: 0, remaining_credits: 0 };
  const rt = Number(row.remaining_tokens) || 0;
  const rc = Number(row.remaining_credits) || 0;
  return { allowed: rt > 0, remaining_tokens: rt, remaining_credits: rc };
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

  return {
    remaining_tokens: data.remaining_tokens,
    remaining_credits: data.remaining_credits,
    tokens_deducted: data.tokens_deducted,
    tokens_per_credit: data.tokens_per_credit,
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
    const err: any = new Error("INSUFFICIENT_CREDITS");
    err.creditInfo = balance;
    throw err;
  }

  // Prefer Lovable AI Gateway when LOVABLE_API_KEY is available; fall back to OpenRouter.
  const useGateway = !!LOVABLE_API_KEY;
  const url = useGateway
    ? `${LOVABLE_GATEWAY_BASE}/${endpoint}`
    : `${OPENROUTER_BASE}/${endpoint}`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (useGateway) {
    headers["Lovable-API-Key"] = LOVABLE_API_KEY;
  } else {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  const r = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!r.ok) {
    const msg = await r.text().catch(() => "");
    throw new Error(`${useGateway ? "Lovable AI Gateway" : "OpenRouter"} ${endpoint} failed: ${r.status} ${msg}`);
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
    provider: useGateway ? "lovable" : "openrouter",
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
