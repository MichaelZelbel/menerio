# Geo Rise — AI Credits System: Hardening & Completion

## Current State Summary

Geo Rise has partial AI credit infrastructure but lacks atomic enforcement.

### ✅ Already Implemented
- **Database tables**: `ai_credit_settings`, `ai_allowance_periods`, `llm_usage_events`, `v_ai_allowance_current` view
- **Edge function**: `ensure-token-allowance` (period initialization)
- **Frontend hooks**: `useAICredits` (fetches balance), `useAICreditsGate` (pre-checks before AI calls)
- **Frontend components**: `CreditsDisplay` (account page), `AICreditSettingsSection` (admin), `UserTokenModal` (admin per-user adjustment)
- **Gate check**: `ChatCoach` calls `checkCredits()` before sending messages
- **Usage logging**: `chat-coach` logs to `llm_usage_events` and manually increments `ai_allowance_periods.tokens_used`
- **Plan-based credits**: Settings include `credits_free_per_month` (0), `credits_pro_per_month` (1500), `credits_business_per_month` (5000)

### ❌ Missing / Needs Fixing

1. **No atomic token deduction** — The `chat-coach` edge function uses a read-then-update pattern (SELECT `tokens_used` → UPDATE `tokens_used + N`), which is vulnerable to race conditions under concurrent requests. Menerio uses an atomic `deduct_ai_tokens` RPC with `FOR UPDATE` row locking.

2. **No `deduct_ai_tokens` database RPC** — The critical atomic deduction function does not exist in Geo Rise's database. This is the single most important missing piece.

3. **No shared `_shared/llm-credits.ts` module** — Token deduction logic is inlined (~60 lines) in `chat-coach/index.ts`. This should be a reusable module.

4. **No balance pre-check in edge function** — `chat-coach` does not check the user's credit balance before calling the Lovable AI Gateway. If the user has 0 credits, the AI call still happens and tokens are still deducted (potentially going negative).

5. **No real-time credit refresh** — After an AI call, the `CreditsDisplay` doesn't update until the user navigates away and back. No event bus exists (`credits-events.ts` is missing).

6. **No LLM Usage Log in admin dashboard** — The admin `AICreditSettingsSection` only shows global settings. There's no paginated table showing `llm_usage_events`.

7. **No credit info returned to frontend** — `chat-coach` returns only `{ reply }` without remaining credit info, so the frontend can't react to low/zero credits.

---

## Implementation Tasks

### Task 1: Create `deduct_ai_tokens` Database RPC

Create a migration that adds the atomic deduction function.

```sql
create or replace function deduct_ai_tokens(
  p_user_id uuid,
  p_tokens integer,
  p_feature text,
  p_model text default null,
  p_provider text default 'lovable',
  p_prompt_tokens integer default 0,
  p_completion_tokens integer default 0,
  p_idempotency_key text default null,
  p_usage_source text default 'unknown'
) returns jsonb language plpgsql security definer as $$
declare
  v_period_id uuid;
  v_remaining_tokens integer;
  v_remaining_credits integer;
  v_tokens_per_credit integer;
  v_tokens_used_before integer;
begin
  -- 1. Lock the active period row
  select id, tokens_granted - tokens_used, (metadata->>'tokens_per_credit')::int
  into v_period_id, v_remaining_tokens, v_tokens_per_credit
  from ai_allowance_periods
  where user_id = p_user_id
    and period_start <= now()
    and period_end > now()
  for update;

  if v_period_id is null then
    return jsonb_build_object('allowed', false, 'error', 'NO_ACTIVE_PERIOD');
  end if;

  if v_remaining_tokens < p_tokens then
    return jsonb_build_object('allowed', false, 'error', 'insufficient_balance');
  end if;

  -- 2. Deduct tokens
  update ai_allowance_periods
  set tokens_used = tokens_used + p_tokens
  where id = v_period_id;

  -- 3. Log usage
  insert into llm_usage_events (user_id, feature, model, provider, prompt_tokens, completion_tokens, total_tokens, credits_charged, idempotency_key, metadata)
  values (p_user_id, p_feature, p_model, p_provider, p_prompt_tokens, p_completion_tokens, p_tokens, ceil(p_tokens::float / v_tokens_per_credit), p_idempotency_key, jsonb_build_object('usage_source', p_usage_source));

  return jsonb_build_object(
    'allowed', true,
    'remaining_tokens', v_remaining_tokens - p_tokens,
    'remaining_credits', ceil((v_remaining_tokens - p_tokens)::float / v_tokens_per_credit),
    'tokens_deducted', p_tokens,
    'tokens_per_credit', v_tokens_per_credit
  );
end;
$$;
```

### Task 2: Create Shared `_shared/llm-credits.ts` Module

```typescript
const LOVABLE_GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";

const FALLBACK_TOKENS: Record<string, number> = {
  "google/gemini-2.5-flash": 500,
};

export interface CreditInfo {
  remaining_tokens: number;
  remaining_credits: number;
  tokens_deducted: number;
  tokens_per_credit?: number;
}

export async function checkBalance(db: any, userId: string) {
  const { data } = await db.from("v_ai_allowance_current").select("remaining_tokens, remaining_credits").eq("user_id", userId).maybeSingle();
  if (!data) return { allowed: false, remaining_tokens: 0, remaining_credits: 0 };
  return { allowed: Number(data.remaining_tokens) > 0, remaining_tokens: Number(data.remaining_tokens), remaining_credits: Number(data.remaining_credits) };
}

export async function deductTokens(db: any, p: any): Promise<CreditInfo> {
  const { data, error } = await db.rpc("deduct_ai_tokens", {
    p_user_id: p.userId,
    p_tokens: p.tokens,
    p_feature: p.feature,
    p_model: p.model,
    p_provider: p.provider || "lovable",
    p_prompt_tokens: p.promptTokens || 0,
    p_completion_tokens: p.completionTokens || 0,
    p_idempotency_key: p.idempotencyKey || null,
    p_usage_source: p.usageSource || "unknown",
  });
  if (error || !data.allowed) throw new Error(error?.message || data.error);
  return data;
}

export async function lovableGatewayWithCredits(db: any, apiKey: string, userId: string, feature: string, body: any) {
  const r = await fetch(LOVABLE_GATEWAY, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await r.json();
  const usage = result.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: FALLBACK_TOKENS[body.model] || 500 };
  const credits = await deductTokens(db, {
    userId,
    tokens: usage.total_tokens,
    feature,
    model: body.model,
    promptTokens: usage.prompt_tokens,
    completionTokens: usage.completion_tokens,
    usageSource: result.usage ? "provider" : "fallback"
  });
  return { result, credits };
}

export function insufficientCreditsResponse(corsHeaders: any) {
  return new Response(JSON.stringify({ error: "Insufficient AI credits" }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
```

### Task 3: Refactor `chat-coach` Edge Function

```typescript
import { checkBalance, lovableGatewayWithCredits, insufficientCreditsResponse } from "../_shared/llm-credits.ts";

// 1. Pre-check balance
const balance = await checkBalance(supabaseAdmin, user.id);
if (!balance.allowed) return insufficientCreditsResponse(corsHeaders);

// 2. Call Lovable AI Gateway
const { result, credits } = await lovableGatewayWithCredits(
  supabaseAdmin,
  LOVABLE_API_KEY,
  user.id,
  "chat_coach",
  { model: "google/gemini-2.5-flash", messages, temperature: 0.7, max_tokens: 400 }
);

const reply = result.choices[0].message.content;

// 3. Return reply + credit info
return new Response(JSON.stringify({ reply, credits: { remaining_credits: credits.remaining_credits } }), { 
  headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
});
```

### Task 4: Create `src/lib/credits-events.ts`

```typescript
const AI_CREDITS_CHANGED = "ai-credits-changed";
export function triggerCreditsRefresh() { window.dispatchEvent(new Event(AI_CREDITS_CHANGED)); }
export function onCreditsChange(callback: () => void): () => void {
  window.addEventListener(AI_CREDITS_CHANGED, callback);
  return () => window.removeEventListener(AI_CREDITS_CHANGED, callback);
}
```

### Task 5: Update `src/hooks/useAICredits.ts`

```typescript
import { onCreditsChange } from "@/lib/credits-events";

// Inside useAICredits hook:
useEffect(() => {
  return onCreditsChange(() => {
    fetchCredits();
  });
}, [fetchCredits]);
```

### Task 6: Trigger Credit Refresh After AI Calls

In `src/components/dashboard/ChatCoach.tsx`:
```typescript
import { triggerCreditsRefresh } from "@/lib/credits-events";

// After successful response:
triggerCreditsRefresh();
```
