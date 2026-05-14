# Fix: Moments → "Suggest with AI" returns non-200

## What's actually happening

The "Suggest" button in the Add Moment dialog calls the `draft-event` Edge Function. The user's "non-200" toast comes from this branch in `supabase/functions/draft-event/index.ts`:

```ts
const toolCall = result.choices?.[0]?.message?.tool_calls?.[0];
if (!toolCall || toolCall.function.name !== "draft_moment")
  return json({ error: "AI did not return a valid moment draft" }, 500);
```

i.e. OpenRouter returned 200 but the model returned plain text instead of the forced `draft_moment` tool call, so we manufacture a 500. Two contributing factors:

1. **Model**: `google/gemini-3-flash-preview` is used. Gemini preview models on OpenRouter handle `tool_choice: { type: "function", ... }` inconsistently — for longer / "sensitive-feeling" descriptions they often respond with content text or trigger safety filters and skip tool calls. Recent successful invocations also log `[llm-credits] No usage data from provider` — confirms the provider response is unstable.
2. **Error surface**: the frontend (`AddEventDialog.handleAiSuggest`) shows a generic `"AI request failed"` toast and never reveals the server-side `error` message. Even when the function returns a precise reason, the user sees the cryptic line.

## Fix plan (frontend + edge function only, no business-logic changes)

### 1. `supabase/functions/draft-event/index.ts`

- **Switch model** to the same one we just standardized on for wiki-ingest: `google/gemini-2.5-flash` (stable, supports tool calls, temp 0.2). Keep the `tool_choice` forcing for `draft_moment`.
- **Robust extraction fallback**: if `tool_calls` is missing, try to parse JSON from `message.content` (strip ```json fences / find first `{...}` block) and validate it against the same schema fields. Only error out if both paths fail.
- **Truncation / refusal detection**: if `finish_reason === "length"` or content matches refusal phrases ("I cannot", "I'm unable", "as a language model"…), return a clear 422 with `code: "AI_REFUSED"` or `code: "AI_TRUNCATED"` and an explanation pointing at the description length.
- **Better error payloads**: when OpenRouter is non-2xx, forward `status` + first 300 chars of provider message in the JSON body (`code: "PROVIDER_ERROR"`). When the model returns nothing usable, return 422 with `code: "AI_NO_DRAFT"` and include `finish_reason` + a short snippet of what the model said, so the user knows whether to shorten / rephrase.
- Log `description.length`, `finish_reason`, and whether the tool_call path or JSON-fallback path was used (so future debugging is one query away).

### 2. `src/components/timeline/AddEventDialog.tsx`

In `handleAiSuggest`:

- Show the server-provided `error`/`code` in the toast instead of a generic message. Map known codes to friendly German strings:
  - `AI_NO_DRAFT` → "Die AI konnte aus dieser Beschreibung keinen Vorschlag bilden. Bitte etwas konkreter formulieren oder kürzen."
  - `AI_REFUSED` → "Die AI hat den Text abgelehnt (vermutlich Safety-Filter). Bitte umformulieren."
  - `AI_TRUNCATED` → "Die Beschreibung ist zu lang für einen Vorschlag. Bitte kürzen."
  - `PROVIDER_ERROR` → "AI-Provider-Fehler: <message>"
  - default → existing fallback
- When `supabase.functions.invoke` throws with the FunctionsHttpError-style "non-2xx", attempt to read the structured body (it is exposed via `error.context?.json()` / `error.context?.text()` on supabase-js v2) and use the `error`/`code` from that payload before falling back to `err.message`.

### 3. Verify

- After deploy: call `draft-event` via `supabase--curl_edge_functions` with a normal description and an artificially long / weird one, check we now get a clean 200 in normal case and a labeled 422 in the failure case instead of an opaque 500.
- Check `supabase--edge_function_logs draft-event` to confirm the new diagnostic log lines appear.

## Files touched

- `supabase/functions/draft-event/index.ts` (model swap, JSON fallback, structured errors, logging)
- `src/components/timeline/AddEventDialog.tsx` (decode server error, friendly toast strings)

No DB changes. No changes to Moments storage / participants logic.
