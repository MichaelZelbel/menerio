
## Fix

Remove the Lovable-Gateway override from `openRouterWithCredits` in `supabase/functions/_shared/llm-credits.ts`. That helper should do what its name says — call OpenRouter with the API key it was handed — and nothing else. Per-call-site provider/model selection already lives in `llm_call_configs` and is honored by `runChat()` in `_shared/llm-router.ts`; that path stays exactly as it is.

### The single edit

In `supabase/functions/_shared/llm-credits.ts`, inside `openRouterWithCredits` (lines 126-136 today), delete the `useGateway` branch and always call OpenRouter:

- `url` = `${OPENROUTER_BASE}/${endpoint}`
- `headers.Authorization` = `Bearer ${apiKey}`
- Error message: `OpenRouter ${endpoint} failed: …`
- `deductTokens({ …, provider: "openrouter" })`

Remove the now-unused `LOVABLE_GATEWAY_BASE` and `LOVABLE_API_KEY` constants at the top of the same file. Leave `deductExternalLLMTokens` alone — that's the correct helper for callers that legitimately hit Lovable Gateway through `runChat`.

Nothing else changes: no call site edits, no config edits, no model changes, no embedding changes.

### Why this is the whole fix

- `runChat` (used by `note-chat`, `conversation-chat`, `collection-chat`, `process-note.metadata`, `admin-llm-config.test`, and all the group-AI / wiki / weekly-review / draft-event / extract-event / suggest-* call sites via `callJson`) already reads `llm_call_configs.provider` and dispatches per-provider — OpenRouter when the row says OpenRouter, Lovable when the row says Lovable, etc. That has been working; nothing routed through it is affected by this bug.
- The only callers still going through `openRouterWithCredits` are the ones that intentionally use OpenRouter directly: `getEmbeddingWithCredits` (embeddings — `openai/text-embedding-3-small` on OpenRouter, must stay OpenRouter to keep vector-space compatibility with existing `note_chunks`) and `chatWithCredits` (legacy). Both should hit OpenRouter. Today they don't because of the override.
- Removing the override restores the previous behavior you remember: provider = whatever is configured.

### Verification

1. Open AI Assistant on a person page → `note-chat.general` (Claude via OpenRouter, per `llm_call_configs`) responds normally.
2. Open AI Assistant on a note and on a collection → both respond.
3. Capture a new note → `process-note.metadata` (DeepSeek via OpenRouter) completes; embeddings insert into `note_chunks`.
4. Tail `note-chat` and `process-note` logs → no more `Lovable AI Gateway … 400 invalid model` lines.

### Out of scope

- No changes to `llm-router.ts`, `llm_call_configs`, any call site, the frontend, or any migration.
