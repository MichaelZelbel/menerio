## Goal

Make every call site's system prompt fully editable in the Admin dialog using n8n-style `{{placeholders}}` for runtime context (date, note content, wiki index, etc.). Admin sees & edits the real prompt; runtime values are substituted before sending. Admin UI strings switched to English.

## Why placeholders (vs. splitting into two messages)

- Works identically across OpenAI / Anthropic / Gemini / OpenRouter — pure string interpolation, no model-specific quirks.
- Matches the n8n mental model the user already knows.
- Single editable field; nothing read-only.
- Trivial to implement: `replace(/\{\{(\w+)\}\}/g, ...)` in the router.

## Implementation

### 1. Router: placeholder interpolation

`supabase/functions/_shared/llm-router.ts`

- Add `templateVars?: Record<string, string>` to `runChat` args and `CallDefaults`.
- New helper `interpolate(prompt, vars)` that replaces `{{key}}` with `vars[key]` (missing key → empty string, log a warning).
- Apply interpolation to `effective.system_prompt` before calling `buildMessagesWithSystem`.
- Also interpolate the caller-supplied `defaults.systemPrompt` (so fallback path behaves the same).

### 2. Seed full defaults for ALL call sites

`supabase/functions/admin-llm-config/index.ts`

- Replace `PROCESS_NOTE_DEFAULTS` with `ALL_CALL_SITE_DEFAULTS` covering every entry currently in `llm_call_configs`:
  - `ai-moderate-content.main`, `analyze-media.ocr/text/vision`, `conversation-chat.main`, `daily-digest.main`, `draft-event.main`, `embeddings.default`, `extract-event.main`, `find-connections.main`, `generate-profile-suggestions.main`, `group-ai.briefing/next_step/suggest_members`, `ingest-thought.metadata`, `note-chat.main`, `process-note.metadata/profile_extraction`, `quick-capture.metadata`, `suggest-connections.main`, `weekly-review.main`, `wiki-cleanup.main`, `wiki-ingest.main`, `wiki-lint.main`.
- Each entry includes the **full** prompt as it currently lives in the edge function, with dynamic spots converted to `{{placeholders}}`.
- `description` set to a short English sentence per call site.
- Since user has not edited any prompts yet, change sync to **plain `upsert` with `onConflict: "call_site"`** that DOES overwrite `system_prompt`. This brings every existing empty row up to date in one shot. After this rollout, change sync back to "insert-only / fill empty fields" so future Admin edits aren't clobbered (one-line guard with a `FORCE_RESEED` flag we flip off after first run).
- `analyze-media.ocr` and `embeddings.default` are not chat endpoints — keep them in the list but mark `system_prompt: null` and hide the prompt field for them in the UI (already partially handled).

### 3. Refactor each edge function to use placeholders

For every call site whose prompt is currently built with string concatenation, change:

```ts
// before
const sys = SYSTEM_PROMPT + `\nToday: ${today}\nPeople: ${peopleList}`;
chatWithCredits(..., [{ role: "system", content: sys }, ...]);
```

to:

```ts
// after — caller provides templateVars; router does the substitution
runChat({
  ...,
  defaults: { provider, model, systemPrompt: SYSTEM_PROMPT_WITH_PLACEHOLDERS },
  templateVars: { currentDate: today, people: peopleList },
  messages: [{ role: "user", content: ... }],
});
```

Affected functions (confirmed by grep):
- `note-chat` — `{{noteContext}}` (or `{{noteTitle}}`, `{{noteBody}}` if useful); General-mode prompt becomes its own call site default.
- `draft-event` — `{{currentDate}}`, `{{peopleContext}}`.
- `wiki-ingest` — `{{existingPagesIndex}}` (replaces today's `.replace("[EXISTING_PAGES_INDEX_HERE]", index)`).
- `conversation-chat` — `{{personName}}`, `{{personContext}}`, etc.
- `generate-profile-suggestions` — currently builds prompt as user message; move the constant analyst instruction to the system prompt with placeholders for category list and stats.
- `extract-event`, `find-connections`, `suggest-connections`, `daily-digest`, `weekly-review`, `wiki-cleanup`, `wiki-lint`, `quick-capture`, `ingest-thought`, `group-ai.*`, `ai-moderate-content`, `process-note.*`, `analyze-media.text/vision` — review each; most are already static, just need the call-site key passed through `runChat`/`chatWithCredits` so the DB row is consulted.

Helpers `chatWithCredits` / `chatWithCreditsStream` in `_shared/llm-credits.ts` need to accept and forward `templateVars` to the router (already routes through `runChat` for the configurable path — extend the same signature).

### 4. Admin UI — English + placeholder hint

`src/components/admin/LLMConfigPanel.tsx`

- Translate all German strings: "Provider", "Model", "System Prompt", "Active", "Test Run", "Save & Test", "Save", "Cancel", "Edit", "OpenRouter-Default", "Code-Default", etc.
- Replace placeholder text "(leer = der hartkodierte Default in der Edge Function wird verwendet)" with: `"Leave empty to use the code default. Use {{placeholders}} for runtime context."`.
- Below the textarea, render a small "Available placeholders:" list per call site (hard-coded mapping `callSite → string[]`), e.g. for `note-chat.main`: `{{noteContext}}`.
- For non-chat call sites (`embeddings.default`, `analyze-media.ocr`) hide the prompt + temperature fields and show a note: `"This endpoint is not a chat call — only provider and model apply."`

### 5. Documentation note in dialog

Tiny info banner at the top of the edit dialog (English):
> "Changes apply immediately for the next call to this call site. Runtime context (dates, note content, etc.) is inserted via `{{placeholder}}` substitution."

## Out of scope

- No DB migration (schema unchanged).
- No change to the credits / usage logging path.
- We keep "OCR" and "embeddings" rows visible in the table for transparency but do not pretend they have prompts.

## Verification

1. Open Admin → each call site's dialog shows the real prompt prefilled (no more "(empty = hardcoded)").
2. Edit `note-chat.main` to prepend "Always reply in German." → in-app note chat replies in German AND still references the open note (proves `{{noteContext}}` interpolation works).
3. Edit `draft-event.main` and check the log: `{{currentDate}}` is replaced with today's ISO date.
4. Set `wiki-ingest.main` system prompt to empty → router falls back to the code default; pipeline still works.
5. Re-open dialog after save → edited value persists.
6. Admin dialog is fully in English; no German strings remain in `LLMConfigPanel.tsx`.
