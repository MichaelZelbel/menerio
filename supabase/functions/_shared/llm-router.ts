/**
 * Central LLM router. Looks up per-call-site config from `llm_call_configs`
 * and routes the call to the configured provider (Lovable AI Gateway,
 * OpenRouter, OpenAI, Anthropic, or Gemini), then deducts credits.
 *
 * Backward-compatible: callers pass a `defaults` block matching their
 * current behaviour. If the DB row is missing or disabled, defaults win.
 */

import { checkBalance, deductTokens, type CreditInfo } from "./llm-credits.ts";

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
  /** True when the provider was paid but the ledger could not record it. */
  deductFailed?: boolean;
}

const FALLBACK_TOKENS: Record<string, number> = {
  "deepseek/deepseek-v4-flash": 500,
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

/**
 * Replace `{{key}}` placeholders with the supplied values. Missing keys collapse
 * to empty string (with a console warning) so a misconfigured prompt never
 * leaks `{{...}}` text to the model.
 */
export function interpolatePrompt(
  prompt: string | null,
  vars?: Record<string, string | number | null | undefined>
): string | null {
  if (!prompt) return prompt;
  if (!vars) return prompt;
  return prompt.replace(/\{\{(\w+)\}\}/g, (_m, key) => {
    const v = vars[key];
    if (v === undefined) {
      console.warn(`[llm-router] missing template var: ${key}`);
      return "";
    }
    return String(v ?? "");
  });
}

/**
 * Resolve the effective system prompt for a call site: DB row's system_prompt
 * (if enabled and non-empty), else the supplied fallback, then run placeholder
 * interpolation. Use this from edge functions that build their own LLM call
 * (custom fetch, tool loops, etc.) instead of going through {@link runChat}.
 */
export async function resolveSystemPrompt(
  db: any,
  callSite: string,
  fallback: string,
  vars?: Record<string, string | number | null | undefined>
): Promise<string> {
  const row = await loadConfig(db, callSite);
  const base = row?.enabled && row.system_prompt && row.system_prompt.trim().length > 0
    ? row.system_prompt
    : fallback;
  return interpolatePrompt(base, vars) ?? "";
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
 * The output-language rule, in one place, for every call site whose answer a
 * human reads.
 *
 * A model writes back in whatever language it leans towards unless told
 * otherwise, and most of this app's call sites run on `deepseek-v4-flash`,
 * which leans Chinese. That stayed invisible for as long as it did because
 * almost every field these prompts return is a fixed choice, an ISO date or a
 * verbatim quote from the note. Free text is the only place it can show, and
 * when it showed, it showed as review-queue cards describing a dog in Chinese.
 *
 * Pass this through `systemSuffix`, never through `defaults.systemPrompt`, so a
 * row in `llm_call_configs` cannot drop it.
 */
export function outputLanguageRule(language: string): string {
  const lang = String(language || "").trim() || "English";
  return `OUTPUT LANGUAGE — write every free-text field you return in ${lang}, whatever language the source material is in.
- This covers titles, descriptions, summaries, labels and reasons: anything a human reads rather than a machine matches on.
- Do NOT translate: personal names, company, brand and product names, addresses, usernames and handles, or any field that must be a verbatim quote from the source. Those stay exactly as written.
- Do NOT translate values from a fixed list of allowed options. Return those exactly as the option is spelled in these instructions.
- If you cannot translate something confidently, keep the original wording rather than guessing.`;
}

/**
 * The other half of the language question, for call sites that describe a note
 * back to its author: a title, a summary, topic tags.
 *
 * These do not get `outputLanguageRule`, because forcing a German note to carry
 * an English title would be a change nobody asked for. What they need is the
 * floor: answer in the language the source is written in, and never in a third
 * one. Without it there is no rule at all, which is how a note about a packing
 * checklist could have been titled in Chinese.
 *
 * Pass through `systemSuffix`, for the same reason as `outputLanguageRule`.
 */
export function sourceLanguageRule(): string {
  return `OUTPUT LANGUAGE — write every free-text field you return in the SAME language the source material is written in.
- A German note gets German text back, an English note gets English text back.
- Never answer in a third language, whatever language you would otherwise lean towards. If the source mixes languages, use the one most of it is written in.
- Leave personal names, company, brand and product names, and place names exactly as they appear in the source. Do not translate them in either direction.`;
}

/**
 * Parse a JSON answer out of a model reply.
 *
 * Every JSON call site passes `response_format: { type: "json_object" }`, and
 * most models honour it. `deepseek-v4-flash` does not always: it sometimes wraps
 * the object in a ```json fence, and a bare `JSON.parse` then throws. In
 * `process-note` that threw inside the extraction try/catch, which returned, so
 * one stray fence cost a note its entire profile extraction. It happened live on
 * 2026-08-17 at 09:10:45. Seven other edge functions had each grown a private
 * copy of this strip; new code should use this one.
 *
 * Returns `null` rather than throwing when there is nothing parseable, so a
 * caller can tell "the model returned nothing usable" apart from "the model
 * returned something and I crashed on it". Those two need different log lines,
 * and conflating them is how a broken prompt hides.
 */
export function parseModelJson<T = unknown>(raw: string | null | undefined): T | null {
  const text = String(raw ?? "").trim();
  if (!text) return null;

  const unfenced = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  for (const candidate of unfenced === text ? [text] : [unfenced, text]) {
    try {
      return JSON.parse(candidate) as T;
    } catch {
      // fall through to the next shape
    }
  }

  // Last resort: the outermost bracketed span, for a reply that wrapped the JSON
  // in prose ("Here is the JSON: {...}").
  const first = unfenced.search(/[[{]/);
  const last = Math.max(unfenced.lastIndexOf("}"), unfenced.lastIndexOf("]"));
  if (first >= 0 && last > first) {
    try {
      return JSON.parse(unfenced.slice(first, last + 1)) as T;
    } catch {
      // give up
    }
  }
  return null;
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
  /** Per-call options that override DB extras (e.g. response_format, tools). */
  callOptions?: Record<string, unknown>;
  /** Skip credit deduction (used for admin test-run; admins still cost). */
  skipDeduct?: boolean;
  /** Values substituted into `{{placeholders}}` inside the system prompt. */
  templateVars?: Record<string, string | number | null | undefined>;
  /**
   * Policy appended to the system prompt AFTER the DB row has had its say, and
   * therefore the one part of the prompt an admin edit or a stale row cannot
   * drop. `defaults.systemPrompt` is only a fallback: the moment a call site has
   * an enabled row in `llm_call_configs`, that row wins and anything written
   * only into the code default is silently discarded. That is how the profile
   * language setting became a no-op. Put invariants here, not in the default.
   */
  systemSuffix?: string;
}): Promise<RunChatResult> {
  const { effective, source } = await resolveConfig(args.db, args.callSite, args.defaults);

  // Check the balance BEFORE contacting a provider.
  //
  // openRouterWithCredits has always pre-checked. runChat did not: it called the
  // provider, then deducted inside a try/catch that only warned. So a user at
  // zero balance kept getting answers — the deduction threw INSUFFICIENT_CREDITS,
  // the warning scrolled past, and the content was returned anyway. The ledger
  // was advisory on the one path every migrated call site uses.
  //
  // Fails CLOSED, matching openRouterWithCredits: an unreadable allowance blocks
  // too, but reports itself as BALANCE_UNAVAILABLE so a caller answering over
  // HTTP can say 503 ("I cannot check") rather than 402 ("you are out").
  //
  // skipDeduct also skips this. That flag is the admin test-run, which exists to
  // exercise a call site regardless of quota.
  if (!args.skipDeduct) {
    const balance = await checkBalance(args.db, args.userId);
    if (!balance.allowed) {
      const err: any = new Error(
        balance.unavailable ? "BALANCE_UNAVAILABLE" : "INSUFFICIENT_CREDITS"
      );
      err.creditInfo = balance;
      throw err;
    }
  }

  const interpolated = interpolatePrompt(effective.system_prompt, args.templateVars);
  const suffixed = args.systemSuffix
    ? `${interpolated ?? ""}${interpolated ? "\n\n" : ""}${args.systemSuffix}`
    : interpolated;
  const messages = buildMessagesWithSystem(args.messages, suffixed);
  const extra = { ...(effective.extra_options ?? {}), ...(args.callOptions ?? {}) };

  let result: any;
  const provider = effective.provider;
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
    case "mistral": {
      const key = Deno.env.get("MISTRAL_API_KEY");
      if (!key) throw new Error("MISTRAL_API_KEY not configured");
      result = await callOpenAICompatible({
        url: "https://api.mistral.ai/v1/chat/completions",
        apiKey: key,
        model: effective.model,
        messages,
        temperature: effective.temperature,
        maxTokens: effective.max_tokens,
        extra,
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
    default: {
      // Unreachable while llm_call_configs_provider_chk matches the Provider
      // union. If those ever drift apart, fail loudly: leaving `result`
      // undefined makes the extraction below yield content:"" , which reads
      // downstream as "the model had nothing to say" rather than as a fault.
      throw new Error(`Unknown LLM provider '${provider}' for ${args.callSite}`);
    }
  }

  const content: string = result?.choices?.[0]?.message?.content ?? "";

  // Deduct credits
  let credits: CreditInfo | undefined;
  let deductFailed = false;
  if (!args.skipDeduct) {
    const usage = result?.usage ?? {};
    const pt = usage.prompt_tokens ?? 0;
    const ct = usage.completion_tokens ?? 0;
    const total = (usage.total_tokens ?? (pt + ct)) || FALLBACK_TOKENS[effective.model] || 300;
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
      // Best-effort tagging of the usage event with the call_site.
      //
      // This used to be one UPDATE ... eq(user_id) with .order().limit(1) hung off
      // it. PostgREST does not scope an UPDATE that way, so every call rewrote
      // the call_site of EVERY row the user had, and the whole ledger ended up
      // stamped with whichever call site wrote last. On 2026-08-27 all 7 days of
      // rows read `profile-audit.main`, which made the ledger useless for finding
      // out what was actually spending. Read the id first, then update that row.
      try {
        const { data: newest } = await args.db
          .from("llm_usage_events")
          .select("id")
          .eq("user_id", args.userId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (newest?.id) {
          await args.db
            .from("llm_usage_events")
            .update({ call_site: args.callSite, config_source: source })
            .eq("id", newest.id);
        }
      } catch {
        // non-fatal
      }
    } catch (err) {
      // The provider has already been paid by this point, so the answer is
      // returned rather than binning work the spend cannot be undone on. But
      // this must never be quiet: it means real money went unrecorded, and the
      // pre-check above is what stops that becoming unlimited.
      deductFailed = true;
      console.error(
        `[llm-router] SPEND NOT RECORDED for ${args.callSite} ` +
          `(user=${args.userId}, model=${effective.model}, tokens=${total}): ` +
          `${(err as Error).message}`
      );
    }
  }

  return {
    content,
    raw: result,
    credits,
    configSource: source,
    model: effective.model,
    provider: effective.provider,
    deductFailed,
  };
}

/**
 * Run a Mistral OCR call. Not a chat endpoint — accepts a `document` payload
 * shaped per Mistral's /v1/ocr API. Uses `llm_call_configs` for model
 * selection and falls back to defaults on missing/disabled rows.
 *
 * Token accounting: OCR doesn't return prompt/completion tokens, so we
 * estimate from `usage_info.pages_processed` (or document type).
 */
export async function runOcr(args: {
  db: any;
  userId: string;
  callSite: string;
  /** Mistral OCR `document` payload, e.g. { type: "document_url", document_url: dataUrl }. */
  document: Record<string, unknown>;
  /** Extra body fields like include_image_base64. */
  extra?: Record<string, unknown>;
  defaults: { model: string };
  /** Cost per processed page (token equivalent for billing). Default 500. */
  tokensPerPage?: number;
}): Promise<{
  raw: any;
  pages: any[];
  model: string;
  configSource: "db" | "fallback-default";
  pagesProcessed: number;
}> {
  const { effective, source } = await resolveConfig(args.db, args.callSite, {
    provider: "mistral",
    model: args.defaults.model,
  });
  if (effective.provider !== "mistral") {
    // OCR endpoint is Mistral-specific; fall back to defaults if misconfigured.
    console.warn(
      `[llm-router] runOcr called with non-mistral provider '${effective.provider}' for ${args.callSite}; using Mistral OCR endpoint with default model.`
    );
  }
  const key = Deno.env.get("MISTRAL_API_KEY");
  if (!key) throw new Error("MISTRAL_API_KEY not configured");

  const model = effective.provider === "mistral" ? effective.model : args.defaults.model;
  const body: Record<string, unknown> = {
    model,
    document: args.document,
    ...(effective.extra_options ?? {}),
    ...(args.extra ?? {}),
  };
  const r = await fetch("https://api.mistral.ai/v1/ocr", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const msg = await r.text().catch(() => "");
    throw new Error(`Mistral OCR failed (${r.status}): ${msg}`);
  }
  const json = await r.json();
  const pages: any[] = Array.isArray(json.pages) ? json.pages : [];
  const pagesProcessed = json.usage_info?.pages_processed ?? pages.length ?? 1;
  const tokens = Math.max(1, pagesProcessed * (args.tokensPerPage ?? 500));

  try {
    await deductTokens(args.db, {
      userId: args.userId,
      tokens,
      feature: args.callSite,
      model,
      provider: "mistral",
      promptTokens: 0,
      completionTokens: 0,
      usageSource: "fallback",
    });
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
    console.warn(`[llm-router] OCR deduct failed for ${args.callSite}:`, (err as Error).message);
  }

  return { raw: json, pages, model, configSource: source, pagesProcessed };
}
