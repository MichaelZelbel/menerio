## Ziel

DeepSeek V4 Flash (OpenRouter) als Auswahloption im Admin-LLM-Panel ergänzen und alle Stellen, an denen heute `openai/gpt-4o-mini` über OpenRouter konfiguriert ist, auf DeepSeek V4 Flash umstellen.

## Modell-Slug

OpenRouter-ID: **`deepseek/deepseek-v4-flash`** — wird überall als Modellname verwendet, Provider bleibt `openrouter`.

## Änderungen

### 1. Admin-Panel-Auswahl erweitern
`src/components/admin/LLMConfigPanel.tsx` — in `MODEL_PRESETS.openrouter` neuen Eintrag ganz oben einfügen:
- `{ value: "deepseek/deepseek-v4-flash", label: "DeepSeek V4 Flash" }`

### 2. Code-Defaults umstellen (gpt-4o-mini → deepseek/deepseek-v4-flash)
Reines Suchen/Ersetzen des Modell-Strings, Provider bleibt `openrouter`:

- `supabase/functions/_shared/llm-defaults.ts` (17 Vorkommen — alle Call-Sites)
- `supabase/functions/_shared/llm-router.ts` (Fallback-Token-Map ergänzen)
- `supabase/functions/_shared/llm-credits.ts` (Token-Map + Direkt-Call Z. 205)
- `supabase/functions/_shared/group-ai.ts` (`MODEL`-Konstante)
- `supabase/functions/_shared/moment-profile-extraction.ts`
- Edge Functions mit hartcodiertem Modell:
  `backfill-metadata`, `daily-digest`, `find-connections`, `generate-profile-suggestions`, `ingest-thought`, `note-chat`, `open-brain-mcp` (4 Vorkommen), `process-note` (2), `quick-capture`, `slack-capture`, `suggest-connections`, `weekly-review`, `wiki-cleanup`, `wiki-lint`

`analyze-pdf` enthält nur einen Kommentar — bleibt unverändert (Funktion nutzt ohnehin Mistral).

### 3. DB-Migration für bestehende `llm_call_configs`-Zeilen

In der DB liegen 19 Konfigurationen mit `model = 'openai/gpt-4o-mini'`, die die Code-Defaults überschreiben. Sie werden mitgezogen:

```sql
UPDATE public.llm_call_configs
SET model = 'deepseek/deepseek-v4-flash',
    updated_at = now()
WHERE provider = 'openrouter'
  AND model = 'openai/gpt-4o-mini';
```

Betroffene Call-Sites: `ai-moderate-content.main`, `daily-digest.main`, `draft-event.main`, `extract-event.main`, `find-connections.main`, `generate-profile-suggestions.main`, `group-ai.{briefing,next_step,suggest_members}`, `ingest-thought.metadata`, `note-chat.summarize`, `process-note.{metadata,profile_extraction}`, `quick-capture.metadata`, `suggest-connections.main`, `weekly-review.main`, `wiki-cleanup.main`, `wiki-ingest.main`, `wiki-lint.main`.

### 4. Nicht im Scope

- Keine Prompt-Änderungen, keine Temperature-/max_tokens-Anpassungen.
- Kein Wechsel von OpenRouter zu Lovable AI Gateway.
- Embeddings (`text-embedding-3-small`) bleiben unverändert.
- Einzelne Call-Sites lassen sich danach im Admin-Panel jederzeit individuell auf andere Modelle zurückstellen.

## Hinweis

Falls OpenRouter den Slug `deepseek/deepseek-v4-flash` (noch) nicht unter diesem Namen anbietet, schlagen die Calls mit 404/„model not found" fehl. In dem Fall korrigieren wir den Slug zentral an einer Stelle (Migration + den oben genannten Code-Stellen) und deployen neu.