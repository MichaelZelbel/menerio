# Cherishly — AI Credits System: Hardening & Completion

## Current State Summary

Cherishly already has significant AI credit infrastructure in place:

### ✅ Already Implemented
- **Database tables**: `ai_credit_settings`, `ai_allowance_periods`, `llm_usage_events`, `v_ai_allowance_current` view
- **Edge function**: `ensure-token-allowance` (with batch init, rollover calculation, admin support)
- **Frontend hooks**: `useAICredits` (fetches balance), `useAICreditsGate` (pre-checks before AI calls)
- **Frontend components**: `CreditsDisplay` (settings page), `AICreditSettings` (admin), `UserTokenModal` (admin per-user adjustment)
- **Gate checks**: `ClaireChat` and `ActivitySuggestion` both call `checkCredits()` before AI calls
- **Usage logging**: Both `claire-chat` and `suggest-activity` edge functions log to `llm_usage_events` and update `ai_allowance_periods.tokens_used`

### ❌ Missing / Needs Fixing

1. **No atomic token deduction** — Edge functions use a read-then-update pattern (`SELECT tokens_used` → `UPDATE tokens_used + N`), which is vulnerable to race conditions. Menerio uses an atomic `deduct_ai_tokens` RPC with `FOR UPDATE` row locking.

2. **No shared `llm-credits.ts` module** — Token deduction logic is duplicated inline in each edge function (~40 lines each in `claire-chat` and `suggest-activity`). This should be a shared module.

3. **No balance pre-check in edge functions** — `claire-chat` doesn't check the user's credit balance before calling n8n. `suggest-activity` doesn't check either. If the user has 0 credits, the AI call still happens and tokens are still deducted (potentially going negative).

4. **No real-time credit refresh** — After an AI call, the sidebar/settings credit display doesn't update until the user navigates away and back. Menerio uses a `credits-events.ts` event bus (`triggerCreditsRefresh()` / `onCreditsChange()`) to update immediately.

5. **No LLM Usage Log in admin dashboard** — The admin `AICreditSettings` component only shows global settings. There's no paginated table showing `llm_usage_events` (who used what, when, how many tokens).

6. **No `deduct_ai_tokens` database RPC** — This is the critical missing piece. Needs a Postgres function that atomically locks the row, checks balance, deducts, and logs — all in one transaction.

---

## Implementation Tasks

### Task 1: Create `deduct_ai_tokens` Database RPC

Create a migration that adds the atomic deduction function. Reference the Menerio project for the exact implementation:

```sql
-- Look up the exact implementation in the Menerio project's migrations
-- Key requirements:
-- 1. FOR UPDATE row lock on ai_allowance_periods
-- 2. Find the active period (period_start <= now, period_end > now)
-- 3. Check remaining balance (tokens_granted - tokens_used >= p_tokens)
-- 4. Atomically increment tokens_used
-- 5. Insert into llm_usage_events with idempotency_key check
-- 6. Return JSON with: allowed, remaining_tokens, remaining_credits, tokens_deducted, tokens_per_credit
-- 7. Handle edge cases: no active period, insufficient balance, duplicate idempotency_key
```

**To get the exact SQL**: Look in Menerio's migration files for `deduct_ai_tokens`. The function signature should accept:
- `p_user_id uuid`
- `p_tokens integer`
- `p_feature text`
- `p_model text DEFAULT NULL`
- `p_provider text DEFAULT 'lovable_gateway'`
- `p_prompt_tokens integer DEFAULT 0`
- `p_completion_tokens integer DEFAULT 0`
- `p_idempotency_key text DEFAULT NULL`
- `p_usage_source text DEFAULT 'unknown'`

### Task 2: Create Shared `_shared/llm-credits.ts` Module

Copy from Menerio project: `supabase/functions/_shared/llm-credits.ts`

**Adaptations needed for Cherishly:**
- The module uses OpenRouter. Cherishly uses **two providers**:
  1. **Lovable AI Gateway** (`https://ai.gateway.lovable.dev/v1/chat/completions`) — used by `suggest-activity`
  2. **n8n webhook** (`https://n8n-cherishly.agentpool.cloud/webhook/claire`) — used by `claire-chat`

- Add a new wrapper function `lovableGatewayWithCredits()` similar to `openRouterWithCredits()` but calling the Lovable gateway URL and using `LOVABLE_API_KEY`.

- For n8n calls (claire-chat), since token usage comes back from n8n (not the gateway directly), use a `deductExternalLLMTokens()` pattern: make the call first, then deduct tokens from the response's usage data.

**File to create**: `supabase/functions/_shared/llm-credits.ts`

```typescript
// Core exports needed:
export { checkBalance } from '...'          // Pre-check balance
export { deductTokens } from '...'          // Atomic deduction via RPC
export { lovableGatewayWithCredits } from '...'  // Lovable AI Gateway wrapper
export { deductExternalLLMTokens } from '...'    // For n8n/external providers
export { insufficientCreditsResponse } from '...' // 402 response helper
```

### Task 3: Refactor `claire-chat` Edge Function

Current problems:
1. No balance pre-check
2. Non-atomic token deduction (read-then-update)
3. ~40 lines of inline deduction logic

**Refactored approach:**
```typescript
import { checkBalance, deductExternalLLMTokens, insufficientCreditsResponse } from "../_shared/llm-credits.ts";

// 1. Pre-check balance BEFORE calling n8n
const balance = await checkBalance(supabase, user.id);
if (!balance.allowed) {
  return insufficientCreditsResponse(corsHeaders);
}

// 2. Call n8n webhook (existing logic)
const response = await fetch(N8N_WEBHOOK_URL, { ... });
const data = await response.json();

// 3. Deduct tokens atomically AFTER getting response
const credits = await deductExternalLLMTokens(
  supabase,
  user.id,
  "claire_chat",
  {
    prompt_tokens: data.usage?.prompt_tokens,
    completion_tokens: data.usage?.completion_tokens,
    total_tokens: data.usage?.total_tokens,
  },
  data.model || "google/gemini-2.5-flash",
  "n8n_workflow"
);

// 4. Return reply + credit info
return json({ reply, credits: { remaining_credits: credits.remaining_credits } });
```

### Task 4: Refactor `suggest-activity` Edge Function

Same problems as claire-chat. Refactored approach:

```typescript
import { checkBalance, lovableGatewayWithCredits, insufficientCreditsResponse } from "../_shared/llm-credits.ts";

// 1. Pre-check balance
const balance = await checkBalance(supabase, user.id);
if (!balance.allowed) {
  return insufficientCreditsResponse(corsHeaders);
}

// 2. Call Lovable gateway WITH credit deduction (all-in-one)
const { result, credits } = await lovableGatewayWithCredits(
  supabase,
  lovableApiKey,
  user.id,
  "suggest_activity",
  { model: "google/gemini-2.5-flash", messages: [...], temperature: 0.9, max_tokens: 200 }
);

const suggestion = result.choices[0]?.message?.content || 'Try something thoughtful today 💕';

// 3. Return suggestion + credit info
return json({ suggestion, credits: { remaining_credits: credits.remaining_credits } });
```

### Task 5: Create `src/lib/credits-events.ts`

Copy from Menerio project: `src/lib/credits-events.ts`

This is a simple event bus — no changes needed:

```typescript
const AI_CREDITS_CHANGED = "ai-credits-changed";

export function triggerCreditsRefresh() {
  window.dispatchEvent(new Event(AI_CREDITS_CHANGED));
}

export function onCreditsChange(callback: () => void): () => void {
  window.addEventListener(AI_CREDITS_CHANGED, callback);
  return () => window.removeEventListener(AI_CREDITS_CHANGED, callback);
}
```

### Task 6: Update `useAICredits` Hook to Listen for Credit Events

Add an effect to the existing `src/hooks/useAICredits.ts`:

```typescript
import { onCreditsChange } from "@/lib/credits-events";

// Add inside the hook:
useEffect(() => {
  return onCreditsChange(() => {
    fetchCredits();
  });
}, [fetchCredits]);
```

### Task 7: Trigger Credit Refresh After AI Calls

In the frontend components that call AI features, dispatch the event after a successful call:

**`src/components/ClaireChat.tsx`:**
```typescript
import { triggerCreditsRefresh } from "@/lib/credits-events";

// After successful AI response:
triggerCreditsRefresh();
```

**`src/components/ActivitySuggestion.tsx`:**
```typescript
import { triggerCreditsRefresh } from "@/lib/credits-events";

// After successful suggestion:
triggerCreditsRefresh();
```

### Task 8: Add LLM Usage Log to Admin Dashboard

Add a new component `src/components/admin/UsageLogTable.tsx` that shows a paginated table of `llm_usage_events`:

**Columns:**
| Column | Source |
|--------|--------|
| Date | `created_at` |
| User | Join with `profiles.display_name` via `user_id` |
| Feature | `feature` (e.g. `claire_chat`, `suggest_activity`) |
| Model | `model` |
| Provider | `provider` |
| Tokens | `total_tokens` (with tooltip showing prompt/completion split) |
| Credits | `credits_charged` |

**Features:**
- Paginated (20 per page)
- Filterable by feature, user, date range
- Summary row showing total tokens/credits for current filter
- Badge for estimated vs provider-reported tokens (from `metadata.estimated`)

**Integration:**
Add a "Usage Log" tab to the admin page alongside the existing "AI Credits" tab. Import and render `<UsageLogTable />` there.

---

## File Reference Map

| What to create/modify | Reference from Menerio |
|---|---|
| `deduct_ai_tokens` migration | Check Menerio's `supabase/migrations/` for the RPC |
| `supabase/functions/_shared/llm-credits.ts` | Copy from `supabase/functions/_shared/llm-credits.ts`, adapt for Lovable Gateway |
| `src/lib/credits-events.ts` | Copy directly from `src/lib/credits-events.ts` |
| `src/hooks/useAICredits.ts` | Add `onCreditsChange` listener (see Menerio's version) |
| `src/components/admin/UsageLogTable.tsx` | New component, reference Menerio's admin page patterns |
| `supabase/functions/claire-chat/index.ts` | Refactor to use shared module |
| `supabase/functions/suggest-activity/index.ts` | Refactor to use shared module |

## Cross-Project Copy Commands

Use these to pull files from Menerio:

```
# Shared LLM credits module (adapt after copying)
cross_project--copy_project_asset from menerio: supabase/functions/_shared/llm-credits.ts

# Credits event bus (use as-is)
cross_project--copy_project_asset from menerio: src/lib/credits-events.ts

# Reference for useAICredits hook pattern
cross_project--read_project_file from menerio: src/hooks/useAICredits.ts
```

## Implementation Order

1. **Migration first** — Create `deduct_ai_tokens` RPC (everything depends on this)
2. **Shared module** — Create `_shared/llm-credits.ts` 
3. **Refactor edge functions** — Update `claire-chat` and `suggest-activity`
4. **Frontend event bus** — Create `credits-events.ts`, update `useAICredits`
5. **Component updates** — Add `triggerCreditsRefresh()` calls
6. **Admin usage log** — Add `UsageLogTable` component and tab
7. **Test end-to-end** — Verify credits deduct, UI refreshes, admin log populates

## Important Notes

- Cherishly uses role names `free`, `pro`, `pro_gift`, `admin` (not `premium`/`premium_gift` like Menerio)
- The Lovable AI Gateway uses `LOVABLE_API_KEY` (already configured in Cherishly)
- Claire Chat goes through n8n, so token data may be estimated — the `usage_source` field should reflect this
- The `deduct_ai_tokens` RPC is the single most important piece — without it, race conditions remain possible
