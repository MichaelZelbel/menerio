# Gravilo — AI Credits System: Hardening & Completion

## Key Difference: Server-Based, Not User-Based

Gravilo tracks AI tokens **per Discord server** (`server_id` / `discord_guild_id`), not per user. This means allowance periods, usage events, and credit displays are all scoped to the currently selected server. When Gravilo becomes a paid SaaS, billing will be per Discord server.

## Current State Summary

### ✅ Already Implemented
- **Database tables**: `ai_credit_settings`, `server_token_allowances`, `server_token_events`, `v_server_token_allowance_current` view
- **Edge functions**:
  - `ensure-server-token-allowance` (period initialization with rollover)
  - `log-server-token-usage` (logs events + increments `tokens_used`)
  - `get-server-token-status` (returns full token status for a server)
  - `chat-server` (pre-checks balance before calling n8n, logs fallback estimates)
- **Frontend hooks**: `useServerTokens` (fetches server balance), `useServerTokenGate` (pre-checks before AI calls)
- **Admin components**: `ServerTokenManagement` (per-server balance adjustment)
- **Bot integration**: `x-bot-secret` auth for Discord bot calls, `discord-message-usage` endpoint
- **Comprehensive docs**: `AI_CREDITS_IMPLEMENTATION_GUIDE.md`, `DISCORD_BOT_TOKEN_INTEGRATION.md`, `N8N_TOKEN_INTEGRATION.md`

### ❌ Missing / Needs Fixing

1. **No atomic token deduction** — `log-server-token-usage` uses a non-atomic read-then-update pattern: it SELECTs `tokens_used`, then UPDATEs `tokens_used + N`. Under concurrent Discord messages, this is vulnerable to race conditions where two messages read the same balance and both succeed. Menerio solves this with a `FOR UPDATE` row lock in a Postgres RPC.

2. **No `deduct_server_tokens` database RPC** — The atomic deduction function does not exist. This is the single most important missing piece. It should mirror Menerio's `deduct_ai_tokens` but use `server_id` instead of `user_id` and operate on `server_token_allowances` instead of `ai_allowance_periods`.

3. **No shared `_shared/llm-credits.ts` module** — Token deduction logic is inlined in `log-server-token-usage` (~60 lines) and duplicated in `chat-server` (fallback estimates). A shared module would centralize this.

4. **No real-time credit refresh** — After a chat in the dashboard, the `ServerTokenDisplay` doesn't update until the user navigates away. No event bus exists (`credits-events.ts` / `token-events.ts` is missing).

5. **No LLM Usage Log in admin dashboard** — The admin `ServerTokenManagement` only allows adjusting balances. There's no paginated table showing individual `server_token_events` (who used what, when, how many tokens, which channel).

6. **`chat-server` uses fallback token estimates** — The `chat-server` edge function estimates tokens with `Math.ceil(text.length / 4)` instead of using actual LLM response usage data. While n8n calls `log-server-token-usage` with real counts, the dashboard chat path uses inaccurate estimates.

---

## Implementation Tasks

### Task 1: Create `deduct_server_tokens` Database RPC

Create a migration that adds an atomic deduction function. This mirrors Menerio's `deduct_ai_tokens` but adapted for server-based tracking:

CREATE OR REPLACE FUNCTION public.deduct_server_tokens(
  p_server_id text,
  p_tokens integer,
  p_feature text,
  p_model text DEFAULT NULL,
  p_provider text DEFAULT 'lovable',
  p_prompt_tokens integer DEFAULT 0,
  p_completion_tokens integer DEFAULT 0,
  p_idempotency_key text DEFAULT NULL,
  p_usage_source text DEFAULT 'unknown',
  p_discord_user_id text DEFAULT NULL,
  p_user_id uuid DEFAULT NULL,
  p_channel_name text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_period_id uuid;
  v_tokens_granted bigint;
  v_tokens_used bigint;
  v_remaining bigint;
  v_tokens_per_credit integer;
BEGIN
  -- Lock the current active period row (prevents race conditions)
  SELECT id, tokens_granted, tokens_used
  INTO v_period_id, v_tokens_granted, v_tokens_used
  FROM server_token_allowances
  WHERE server_id = p_server_id
    AND period_start <= now()
    AND period_end > now()
  ORDER BY period_start DESC
  LIMIT 1
  FOR UPDATE;

  IF v_period_id IS NULL THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'error', 'no_active_period',
      'remaining_tokens', 0,
      'remaining_credits', 0
    );
  END IF;

  -- Get tokens_per_credit setting
  SELECT COALESCE(value_int, 200)
  INTO v_tokens_per_credit
  FROM ai_credit_settings
  WHERE key = 'tokens_per_credit';

  IF v_tokens_per_credit IS NULL THEN
    v_tokens_per_credit := 200;
  END IF;

  v_remaining := v_tokens_granted - v_tokens_used;

  IF v_remaining < p_tokens THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'error', 'insufficient_balance',
      'remaining_tokens', v_remaining,
      'remaining_credits', v_remaining / v_tokens_per_credit
    );
  END IF;

  -- Atomically deduct tokens
  UPDATE server_token_allowances
  SET tokens_used = tokens_used + p_tokens, updated_at = now()
  WHERE id = v_period_id;

  v_remaining := v_tokens_granted - (v_tokens_used + p_tokens);

  -- Log usage event (idempotency-safe)
  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO server_token_events (
      server_id, user_id, discord_user_id, channel_name,
      feature, model, provider,
      prompt_tokens, completion_tokens, total_tokens,
      credits_charged, idempotency_key, metadata
    ) VALUES (
      p_server_id, p_user_id, p_discord_user_id, p_channel_name,
      p_feature, p_model, p_provider,
      p_prompt_tokens, p_completion_tokens, p_tokens,
      CEIL(p_tokens::numeric / v_tokens_per_credit),
      p_idempotency_key,
      jsonb_build_object('usage_source', p_usage_source)
    ) ON CONFLICT (idempotency_key) DO NOTHING;
  ELSE
    INSERT INTO server_token_events (
      server_id, user_id, discord_user_id, channel_name,
      feature, model, provider,
      prompt_tokens, completion_tokens, total_tokens,
      credits_charged, metadata
    ) VALUES (
      p_server_id, p_user_id, p_discord_user_id, p_channel_name,
      p_feature, p_model, p_provider,
      p_prompt_tokens, p_completion_tokens, p_tokens,
      CEIL(p_tokens::numeric / v_tokens_per_credit),
      jsonb_build_object('usage_source', p_usage_source)
    );
  END IF;

  RETURN jsonb_build_object(
    'allowed', true,
    'tokens_deducted', p_tokens,
    'remaining_tokens', v_remaining,
    'remaining_credits', v_remaining / v_tokens_per_credit,
    'tokens_per_credit', v_tokens_per_credit
  );
END;
$$;

Key differences from Menerio's `deduct_ai_tokens`:
- Uses `p_server_id text` instead of `p_user_id uuid`
- Operates on `server_token_allowances` instead of `ai_allowance_periods`
- Logs to `server_token_events` instead of `llm_usage_events`
- Includes extra server-specific params: `p_discord_user_id`, `p_user_id`, `p_channel_name`

### Task 2: Create Shared `_shared/server-token-credits.ts` Module

Create a new shared module adapted from Menerio's `_shared/llm-credits.ts`:

import { SupabaseClient } from '@supabase/supabase-js';

export async function checkServerBalance(supabase: SupabaseClient, serverId: string) {
  const { data, error } = await supabase
    .from('v_server_token_allowance_current')
    .select('*')
    .eq('server_id', serverId)
    .single();
  
  if (error || !data) return { allowed: false, credits_granted: 0 };
  return { 
    allowed: (data.tokens_granted - data.tokens_used) > 0,
    credits_granted: Math.floor(data.tokens_granted / 200) 
  };
}

export async function deductServerTokens(supabase: SupabaseClient, params: any) {
  const { data, error } = await supabase.rpc('deduct_server_tokens', {
    p_server_id: params.serverId,
    p_tokens: params.tokens,
    p_feature: params.feature,
    p_model: params.model,
    p_provider: params.provider,
    p_prompt_tokens: params.promptTokens,
    p_completion_tokens: params.completionTokens,
    p_idempotency_key: params.idempotencyKey,
    p_usage_source: params.usageSource,
    p_discord_user_id: params.discordUserId,
    p_user_id: params.userId,
    p_channel_name: params.channelName
  });

  if (error || !data?.allowed) throw new Error("INSUFFICIENT_CREDITS");
  return data;
}

export function insufficientCreditsResponse(corsHeaders: any) {
  return new Response(JSON.stringify({ error: "Insufficient credits" }), {
    status: 402,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

### Task 3: Refactor `log-server-token-usage` Edge Function

Replace the non-atomic read-then-update pattern with a single RPC call:

import { checkServerBalance, deductServerTokens, insufficientCreditsResponse } from "../_shared/server-token-credits.ts";

// 1. Ensure allowance period exists
const allowance = await ensureServerAllowance(supabaseAdmin, server_id);

// 2. Atomically deduct via RPC
try {
  const credits = await deductServerTokens(supabaseAdmin, {
    serverId: server_id,
    tokens: totalTokens,
    feature,
    model,
    provider,
    promptTokens: prompt_tokens,
    completionTokens: completion_tokens,
    discordUserId: discord_user_id,
    userId: user_id || authenticatedUserId,
    channelName: channel_name,
    idempotencyKey: idempotency_key,
    usageSource: "provider",
  });

  return json({
    success: true,
    tokens_used: credits.tokens_deducted,
    tokens_remaining: credits.remaining_tokens,
    credits_remaining: credits.remaining_credits,
  });
} catch (err) {
  if (err.message === "INSUFFICIENT_CREDITS") {
    return insufficientCreditsResponse(corsHeaders);
  }
  throw err;
}

### Task 4: Refactor `chat-server` Edge Function

Replace the inline token estimation with the shared module:

import { checkServerBalance, deductServerTokens, insufficientCreditsResponse } from "../_shared/server-token-credits.ts";

// 1. Pre-check balance
const balance = await checkServerBalance(supabaseAdmin, server_id);
if (!balance.allowed) {
  return insufficientCreditsResponse(corsHeaders);
}

// 2. Call n8n
const n8nResponse = await fetch(N8N_URL, { ... });

// 3. Atomically deduct tokens
const usage = n8nResponse.usage || {};
const estimatedTokens = Math.ceil(query.length / 4) + Math.ceil(answerText.length / 4);
const totalTokens = usage.total_tokens || estimatedTokens;

const credits = await deductServerTokens(supabaseAdmin, {
  serverId: server_id,
  tokens: totalTokens,
  feature: "dashboard_chat",
  userId: user.id,
  usageSource: usage.total_tokens ? "provider" : "fallback",
});

// 4. Return answer + credit info
return json({
  answer: answerText,
  credits_remaining: credits.remaining_credits,
  credits_granted: balance.credits_granted,
});

### Task 5: Create `src/lib/server-token-events.ts`

const SERVER_TOKENS_CHANGED = "server-tokens-changed";

export function triggerServerTokensRefresh() {
  window.dispatchEvent(new Event(SERVER_TOKENS_CHANGED));
}

export function onServerTokensChange(callback: () => void): () => void {
  window.addEventListener(SERVER_TOKENS_CHANGED, callback);
  return () => window.removeEventListener(SERVER_TOKENS_CHANGED, callback);
}

### Task 6: Update `useServerTokens` Hook to Listen for Events

import { onServerTokensChange } from "@/lib/server-token-events";

useEffect(() => {
  return onServerTokensChange(() => {
    fetchTokenStatus();
  });
}, [fetchTokenStatus]);

### Task 7: Trigger Token Refresh After AI Calls

import { triggerServerTokensRefresh } from "@/lib/server-token-events";

// After successful chat response:
triggerServerTokensRefresh();

### Task 8: Add Server Token Usage Log to Admin Dashboard

Add a new component `src/components/admin/ServerUsageLogTable.tsx` that shows a paginated table of `server_token_events`.

## File Reference Map

| What to create/modify | Reference from Menerio |
|---|---|
| `deduct_server_tokens` migration | Adapt Menerio's `deduct_ai_tokens` RPC for server-based tracking |
| `supabase/functions/_shared/server-token-credits.ts` | Adapt from `supabase/functions/_shared/llm-credits.ts` |
| `src/lib/server-token-events.ts` | Adapt from `src/lib/credits-events.ts` |
| `src/hooks/useServerTokens.ts` | Add `onServerTokensChange` listener |
| `src/components/admin/ServerUsageLogTable.tsx` | New component |
| `supabase/functions/log-server-token-usage/index.ts` | Refactor to use shared module + atomic RPC |
| `supabase/functions/chat-server/index.ts` | Refactor to use shared module + atomic RPC |

## Implementation Order

1. **Migration first** — Create `deduct_server_tokens` RPC (everything depends on this)
2. **Shared module** — Create `_shared/server-token-credits.ts`
3. **Refactor edge functions** — Update `log-server-token-usage` and `chat-server`
4. **Frontend event bus** — Create `server-token-events.ts`, update `useServerTokens`
5. **Component updates** — Add `triggerServerTokensRefresh()` calls
6. **Admin usage log** — Add `ServerUsageLogTable` component
7. **Test end-to-end** — Verify atomic deduction, UI refresh, admin log

## Important Notes

- **Server-based, not user-based**: All token tracking uses `server_id` (discord_guild_id as text), not `user_id` (uuid). This is the fundamental architectural difference from all other projects.
- **Two token tables**: `server_token_allowances` (not `ai_allowance_periods`) and `server_token_events` (not `llm_usage_events`).
- **Plans**: `free` (300 credits / 60,000 tokens) and `premium` (3,000 credits / 600,000 tokens) — stored in `server_plans` table, not `user_roles`.
- **Dual auth**: Edge functions accept both `x-bot-secret` (Discord bot) and JWT (dashboard users).
- **n8n pipeline**: Most LLM calls go through n8n, which calls `log-server-token-usage` with actual token counts. The `chat-server` function is the only direct LLM caller (for dashboard chat) and currently uses fallback estimates.
- **The `deduct_server_tokens` RPC is the single most important piece** — without it, concurrent Discord messages can cause race conditions.
