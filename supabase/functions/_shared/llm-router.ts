/**
 * Central LLM router. Looks up per-call-site config from `llm_call_configs`
 * and routes the call to the configured provider (Lovable AI Gateway,
 * OpenRouter, OpenAI, Anthropic, or Gemini), then deducts credits.
 *
 * Backward-compatible: callers pass a `defaults` block matching their
 * current behaviour. If the DB row is missing or disabled, defaults win.
 */

import { deductTokens, type CreditInfo } from "./llm-credits.ts";

export type Provider = "lovable" | "openrouter" | "openai" | "anthropic" | "gemini" | "mistral";

export interface CallConfig {
  call_site: string;
  provider: Provider;
  model: string;
  system_prompt: string | null;
  temperature: number | null;
  max_tokens: number | null;
  extra_options: Record<string, unknown>;
  enabled: boolean;
}

export interface CallDefaults {
  provider: Provider;
  model: string;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
}

export interface RunChatResult {
  content: string;
  raw: unknown;
  credits?: CreditInfo;
  configSource: "db" | "fallback-default";
  model: string;
  provider: Provider;
}

const FALLBACK_TOKENS: Record<string, number> = {
  "openai/gpt-4o-mini": 500,
  "google/gemini-2.5-flash": 500,
  "google/gemini-3-flash-preview": 500,
};

const configCache = new Map<string, { value: CallConfig | null; at: number }>();
const CACHE_TTL_MS = 30_000;

async function loadConfig(db: any, callSite: string): Promise<CallConfig | null> {
  const cached = configCache.get(callSite);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;
  const { data, error } = await db
    .from("llm_call_configs")
    .select("call_site, provider, model, system_prompt, temperature, max_tokens, extra_options, enabled")
    .eq("call_site", callSite)
    .maybeSingle();
  if (error) {
    console.warn(`[llm-router] config load failed for ${callSite}:`, error.message);
    configCache.set(callSite, { value: null, at: Date.now() });
    return null;
  }
  configCache.set(callSite, { value: data as CallConfig | null, at: Date.now() });
  return data as CallConfig | null;
}

/** Resolve effective config: DB row (if enabled) overrides defaults. */
export async function resolveConfig(
  db: any,
  callSite: string,
  defaults: CallDefaults
): Promise<{ effective: CallConfig; source: "db" | "fallback-default" }> {
  const row = await loadConfig(db, callSite);
  if (!row || !row.enabled) {
    return {
      effective: {
        call_site: callSite,
        provider: defaults.provider,
        model: defaults.model,
        system_prompt: defaults.systemPrompt ?? null,
        temperature: defaults.temperature ?? null,
        max_tokens: defaults.maxTokens ?? null,
        extra_options: {},
        enabled: true,
      },
      source: "fallback-default",
    };
  }
  return { effective: row, source: "db" };
}

function buildMessagesWithSystem(messages: ChatMessage[], systemPrompt: string | null): ChatMessage[] {
  if (!systemPrompt) return messages;
  // Replace existing system message if any, else prepend
  const hasSystem = messages.some((m) => m.role === "system");
  if (hasSystem) {
    return messages.map((m) => (m.role === "system" ? { ...m, content: systemPrompt } : m));
  }
  return [{ role: "system", content: systemPrompt }, ...messages];
}

async function callOpenAICompatible(opts: {
  url: string;
  apiKey: string;
  headers?: Record<string, string>;
  model: string;
  messages: ChatMessage[];
  temperature?: number | null;
  maxTokens?: number | null;
  extra: Record<string, unknown>;
}) {
  const body: Record<string, unknown> = {
    model: opts.model,
    messages: opts.messages,
    ...opts.extra,
  };
  if (opts.temperature != null) body.temperature = opts.temperature;
  if (opts.maxTokens != null) body.max_tokens = opts.maxTokens;

  const r = await fetch(opts.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      "Content-Type": "application/json",
      ...(opts.headers ?? {}),
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const msg = await r.text().catch(() => "");
    throw new Error(`LLM call failed (${r.status}): ${msg}`);
  }
  return r.json();
}

async function callAnthropic(opts: {
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  temperature?: number | null;
  maxTokens?: number | null;
}) {
  const systemMsg = opts.messages.find((m) => m.role === "system")?.content ?? "";
  const conv = opts.messages.filter((m) => m.role !== "system");
  const body: Record<string, unknown> = {
    model: opts.model,
    max_tokens: opts.maxTokens ?? 1024,
    system: systemMsg || undefined,
    messages: conv.map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content })),
  };
  if (opts.temperature != null) body.temperature = opts.temperature;
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": opts.apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Anthropic call failed (${r.status}): ${await r.text().catch(() => "")}`);
  const json = await r.json();
  const content = (json.content || []).map((b: any) => b.text || "").join("");
  return {
    choices: [{ message: { content } }],
    usage: {
      prompt_tokens: json.usage?.input_tokens ?? 0,
      completion_tokens: json.usage?.output_tokens ?? 0,
      total_tokens: (json.usage?.input_tokens ?? 0) + (json.usage?.output_tokens ?? 0),
    },
    _raw: json,
  };
}

async function callGemini(opts: {
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  temperature?: number | null;
  maxTokens?: number | null;
}) {
  const systemMsg = opts.messages.find((m) => m.role === "system")?.content;
  const contents = opts.messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));
  const body: Record<string, unknown> = { contents };
  if (systemMsg) body.systemInstruction = { parts: [{ text: systemMsg }] };
  const genCfg: Record<string, unknown> = {};
  if (opts.temperature != null) genCfg.temperature = opts.temperature;
  if (opts.maxTokens != null) genCfg.maxOutputTokens = opts.maxTokens;
  if (Object.keys(genCfg).length) body.generationConfig = genCfg;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(opts.model)}:generateContent?key=${opts.apiKey}`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Gemini call failed (${r.status}): ${await r.text().catch(() => "")}`);
  const json = await r.json();
  const content = (json.candidates?.[0]?.content?.parts ?? []).map((p: any) => p.text || "").join("");
  const usage = json.usageMetadata || {};
  return {
    choices: [{ message: { content } }],
    usage: {
      prompt_tokens: usage.promptTokenCount ?? 0,
      completion_tokens: usage.candidatesTokenCount ?? 0,
      total_tokens: usage.totalTokenCount ?? 0,
    },
    _raw: json,
  };
}

/**
 * Run a chat completion through the configured provider and deduct credits.
 */
export async function runChat(args: {
  db: any;
  userId: string;
  callSite: string;
  messages: ChatMessage[];
  defaults: CallDefaults;
  /** Per-call options that override DB extras (e.g. response_format). */
  callOptions?: Record<string, unknown>;
  /** Skip credit deduction (used for admin test-run; admins still cost). */
  skipDeduct?: boolean;
}): Promise<RunChatResult> {
  const { effective, source } = await resolveConfig(args.db, args.callSite, args.defaults);
  const messages = buildMessagesWithSystem(args.messages, effective.system_prompt);
  const extra = { ...(effective.extra_options ?? {}), ...(args.callOptions ?? {}) };

  let result: any;
  let provider = effective.provider;
  switch (provider) {
    case "lovable": {
      const key = Deno.env.get("LOVABLE_API_KEY");
      if (!key) throw new Error("LOVABLE_API_KEY not configured");
      result = await callOpenAICompatible({
        url: "https://ai.gateway.lovable.dev/v1/chat/completions",
        apiKey: key,
        headers: { "Lovable-API-Key": key },
        model: effective.model,
        messages,
        temperature: effective.temperature,
        maxTokens: effective.max_tokens,
        extra,
      });
      break;
    }
    case "openrouter": {
      const key = Deno.env.get("OPENROUTER_API_KEY");
      if (!key) throw new Error("OPENROUTER_API_KEY not configured");
      result = await callOpenAICompatible({
        url: "https://openrouter.ai/api/v1/chat/completions",
        apiKey: key,
        model: effective.model,
        messages,
        temperature: effective.temperature,
        maxTokens: effective.max_tokens,
        extra,
      });
      break;
    }
    case "openai": {
      const key = Deno.env.get("OPENAI_API_KEY");
      if (!key) throw new Error("OPENAI_API_KEY not configured. Add it in Project Settings → Secrets.");
      result = await callOpenAICompatible({
        url: "https://api.openai.com/v1/chat/completions",
        apiKey: key,
        model: effective.model,
        messages,
        temperature: effective.temperature,
        maxTokens: effective.max_tokens,
        extra,
      });
      break;
    }
    case "anthropic": {
      const key = Deno.env.get("ANTHROPIC_API_KEY");
      if (!key) throw new Error("ANTHROPIC_API_KEY not configured");
      result = await callAnthropic({
        apiKey: key,
        model: effective.model,
        messages,
        temperature: effective.temperature,
        maxTokens: effective.max_tokens,
      });
      break;
    }
    case "gemini": {
      const key = Deno.env.get("GEMINI_API_KEY");
      if (!key) throw new Error("GEMINI_API_KEY not configured. Add it in Project Settings → Secrets.");
      result = await callGemini({
        apiKey: key,
        model: effective.model,
        messages,
        temperature: effective.temperature,
        maxTokens: effective.max_tokens,
      });
      break;
    }
  }

  const content: string = result?.choices?.[0]?.message?.content ?? "";

  // Deduct credits
  let credits: CreditInfo | undefined;
  if (!args.skipDeduct) {
    const usage = result?.usage ?? {};
    const pt = usage.prompt_tokens ?? 0;
    const ct = usage.completion_tokens ?? 0;
    const total = usage.total_tokens ?? (pt + ct) ?? FALLBACK_TOKENS[effective.model] ?? 300;
    const usageSource = pt || ct || usage.total_tokens ? "provider" : "fallback";
    try {
      credits = await deductTokens(args.db, {
        userId: args.userId,
        tokens: total,
        feature: args.callSite,
        model: effective.model,
        provider: effective.provider,
        promptTokens: pt,
        completionTokens: ct,
        usageSource,
      });
      // Best-effort tagging of the usage event with the call_site
      try {
        await args.db
          .from("llm_usage_events")
          .update({ call_site: args.callSite, config_source: source })
          .eq("user_id", args.userId)
          .order("created_at", { ascending: false })
          .limit(1);
      } catch {
        // non-fatal
      }
    } catch (err) {
      console.warn(`[llm-router] deduct failed for ${args.callSite}:`, (err as Error).message);
    }
  }

  return {
    content,
    raw: result,
    credits,
    configSource: source,
    model: effective.model,
    provider: effective.provider,
  };
}
