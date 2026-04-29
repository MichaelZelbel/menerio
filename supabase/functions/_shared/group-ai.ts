import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { checkBalance, deductTokens } from "./llm-credits.ts";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

export const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
export const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;
export const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
export const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY")!;
export const MODEL = "openai/gpt-4o-mini";

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

export async function callJson(messages: Array<{ role: string; content: string }>) {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENROUTER_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, messages, temperature: 0.2, response_format: { type: "json_object" } }),
  });
  if (!response.ok) throw new Error(`LLM call failed: ${response.status} ${await response.text().catch(() => "")}`);
  const data = await response.json();
  return JSON.parse(data.choices?.[0]?.message?.content || "{}");
}

export async function callMarkdown(messages: Array<{ role: string; content: string }>) {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENROUTER_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, messages, temperature: 0.25 }),
  });
  if (!response.ok) throw new Error(`LLM call failed: ${response.status} ${await response.text().catch(() => "")}`);
  const data = await response.json();
  return String(data.choices?.[0]?.message?.content || "").trim();
}

const UNTRUSTED_TEXT_KEYS = new Set(["name", "title", "summary", "content", "description", "purpose", "company", "role", "notes", "reasoning"]);

export function sanitizePromptText(value: unknown, maxLength = 500) {
  return String(value ?? "")
    .replace(/```/g, "\u0060\u0060\u0060")
    .replace(/`/g, "\u0060")
    .replace(/"""/g, "\u0022\u0022\u0022")
    .slice(0, maxLength);
}

export function sanitizePromptData<T>(value: T, key = ""): T {
  if (typeof value === "string") return (UNTRUSTED_TEXT_KEYS.has(key) ? sanitizePromptText(value) : value) as T;
  if (Array.isArray(value)) return value.map((item) => sanitizePromptData(item)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([entryKey, entryValue]) => [entryKey, sanitizePromptData(entryValue, entryKey)]),
    ) as T;
  }
  return value;
}

export function taggedPrompt(sections: Record<string, unknown>) {
  return Object.entries(sections)
    .map(([tag, value]) => `<${tag}>\n${JSON.stringify(sanitizePromptData(value), null, 2)}\n</${tag}>`)
    .join("\n\n");
}

export function noteText(note: { title?: string | null; content?: string | null }) {
  return `${sanitizePromptText(note.title || "Untitled")}: ${sanitizePromptText((note.content || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " "))}`;
}