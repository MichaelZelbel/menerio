import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { checkBalance, deductTokens } from "./llm-credits.ts";
import { runChat } from "./llm-router.ts";

// The prompt-safety helpers live in their own module because this one imports
// the Supabase client from esm.sh, which the Node test runner cannot resolve —
// so nothing in here could be unit tested. Re-exported so callers are unchanged.
export { noteText, sanitizePromptData, sanitizePromptText, taggedPrompt } from "./prompt-safety.ts";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

export const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
export const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;
export const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
export const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY")!;
export const MODEL = "deepseek/deepseek-v4-flash";

export function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

export function extractBearer(req: Request) {
  const match = (req.headers.get("Authorization") || "").match(/^Bearer\s+(.+)$/i);
  return match?.[1] || null;
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function getAuthedAdmin(req: Request) {
  const token = extractBearer(req);
  if (!token) throw Object.assign(new Error("Unauthenticated"), { status: 401 });
  const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { data, error } = await authClient.auth.getUser(token);
  if (error || !data.user) throw Object.assign(new Error("Unauthenticated"), { status: 401 });
  return { userId: data.user.id, admin: createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY) };
}

export async function getFeatureCreditCost(admin: any, feature: string) {
  const [{ data: featureSetting, error: featureError }, { data: tokenSetting, error: tokenError }] = await Promise.all([
    admin.from("ai_credit_settings").select("value_int").eq("key", feature).maybeSingle(),
    admin.from("ai_credit_settings").select("value_int").eq("key", "tokens_per_credit").maybeSingle(),
  ]);
  if (featureError) throw featureError;
  if (tokenError) throw tokenError;
  const credits = Number(featureSetting?.value_int || 0);
  const tokensPerCredit = Number(tokenSetting?.value_int || 200);
  return { credits, tokens: Math.max(1, credits * tokensPerCredit), tokensPerCredit };
}

export async function ensureCredits(admin: any, userId: string, feature: string) {
  const cost = await getFeatureCreditCost(admin, feature);
  const balance = await checkBalance(admin, userId);
  if (!balance.allowed || balance.remaining_credits < cost.credits) {
    throw Object.assign(new Error("Insufficient credits"), { status: 402, code: "INSUFFICIENT_CREDITS" });
  }
  return cost;
}

export async function deductFixedCredits(admin: any, userId: string, feature: string, tokens: number) {
  return deductTokens(admin, {
    userId,
    tokens,
    feature,
    model: MODEL,
    provider: "openrouter",
    usageSource: "fallback",
  });
}

/**
 * JSON-returning chat call routed through the central LLM router so the system
 * prompt is taken from `llm_call_configs` (admin-editable) with the call-site
 * default as fallback. Caller still owns the user message; the system message
 * (if present in `messages`) is replaced by the configured prompt.
 */
export async function callJson(
  db: any,
  userId: string,
  callSite: string,
  messages: Array<{ role: string; content: string }>,
) {
  const result = await runChat({
    db,
    userId,
    callSite,
    messages,
    defaults: { provider: "openrouter", model: MODEL },
    callOptions: { response_format: { type: "json_object" } },
  });
  return JSON.parse(result.content || "{}");
}

export async function callMarkdown(
  db: any,
  userId: string,
  callSite: string,
  messages: Array<{ role: string; content: string }>,
) {
  const result = await runChat({
    db,
    userId,
    callSite,
    messages,
    defaults: { provider: "openrouter", model: MODEL },
  });
  return String(result.content || "").trim();
}
