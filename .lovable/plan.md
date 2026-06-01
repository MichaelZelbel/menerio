# LLM Call Configuration in Admin

## Ziel

Du sollst in der Admin-Section pro „Call-Site" (z. B. `process-note`, `note-chat`, `analyze-media`, `find-connections`, `daily-digest`, `quick-capture` …) festlegen können:

1. **System-Prompt** (überschreibbar pro Call-Site)
2. **Provider** (Lovable AI Gateway, OpenRouter, später optional eigene OpenAI/Anthropic/Gemini-Keys)
3. **Modell** (frei wählbar pro Provider, inkl. OpenRouter „auto"-Routing oder kostenlose `:free`-Modelle)
4. **Status pro Eintrag** (aktiv/inaktiv → fällt automatisch auf Default zurück)

Das ist **machbar und kein Denkfehler**, aber kein Mini-Change. Heute sind Prompts und Modellnamen hart in ~25 Edge Functions verdrahtet (`_shared/llm-credits.ts` + `_shared/group-ai.ts` + diverse `process-note`, `note-chat`, …). Wir zentralisieren das in einer einzigen Tabelle + einem Helper, und bauen darauf eine Admin-UI.

## Architektur

```text
 Admin UI  ──►  llm_call_configs  ──►  _shared/llm-router.ts
                                            │
                                            ├─► Lovable AI Gateway
                                            ├─► OpenRouter (spezifisches Modell ODER openrouter/auto)
                                            └─► OpenAI / Anthropic / Gemini (eigene Keys, optional)
                                            
 LLM Usage Log bekommt zusätzlich: call_site, config_id, system_prompt_hash
```

## Umsetzung in 4 Schritten

### 1. Datenmodell (Migration)

Neue Tabelle `public.llm_call_configs`:
- `call_site text primary key` — stabiler Bezeichner, z. B. `process-note.profile_extraction`
- `description text` — was dieser Call tut (für die UI)
- `provider text` — `lovable` | `openrouter` | `openai` | `anthropic` | `gemini`
- `model text` — z. B. `google/gemini-3-flash-preview`, `openrouter/auto`, `meta-llama/llama-3.3-70b-instruct:free`
- `system_prompt text` — optional; wenn `NULL` → Code-Default
- `temperature numeric`, `max_tokens int`, `extra_options jsonb`
- `enabled boolean default true`
- `updated_by uuid`, `updated_at timestamptz`

RLS: nur `has_role(auth.uid(), 'admin')` darf lesen/schreiben. GRANTs für `authenticated` + `service_role`.

Seed-Migration füllt die Tabelle mit allen heute existierenden Call-Sites und ihren aktuellen Defaults (extrahiert aus den Edge Functions), damit nichts an Verhalten kippt.

Zusätzlich `llm_usage_log` um `call_site text` und `config_id text` ergänzen, damit du im Admin-Log siehst, welcher Eintrag welchen Call gefahren hat.

### 2. Zentraler Router (`supabase/functions/_shared/llm-router.ts`)

Eine Funktion `runLLM({ callSite, userId, messages, defaults })`:
- Lädt Config aus `llm_call_configs` (mit kurzem In-Memory-Cache pro Cold-Start).
- Fällt bei `enabled=false` oder Fehlern auf `defaults` zurück.
- Wählt Provider-Adapter:
  - **Lovable AI Gateway** → bestehender Pfad (Header `Lovable-API-Key`).
  - **OpenRouter** → bestehender Pfad in `llm-credits.ts`. Sonderfall `model = "openrouter/auto"` ⇒ OpenRouter wählt selbst.
  - **OpenAI/Anthropic/Gemini** → optionaler 2. Bauschritt; nur aktivieren, wenn entsprechende Secrets existieren (`OPENAI_API_KEY` etc.). Andernfalls in der UI als „Provider nicht konfiguriert" ausgrauen.
- Wendet `system_prompt` aus DB an (überschreibt den im Code), kombiniert mit user-/assistant-Messages.
- Verwendet weiterhin `deductTokens` / `deductExternalLLMTokens`, schreibt `call_site` und `config_id` in `llm_usage_log`.

Alle bestehenden Edge Functions werden umgestellt, statt `chatWithCredits(...)` direkt → `runLLM({ callSite: "process-note.profile_extraction", ... })`. Default-System-Prompt bleibt im Code als Fallback.

### 3. Admin-UI (`src/pages/Admin.tsx` + neuer Tab `LLM Configuration`)

- Tabelle aller Call-Sites mit Spalten: Beschreibung, Provider, Modell, Enabled, „letzter Aufruf".
- Edit-Dialog pro Zeile:
  - Provider-Dropdown (nur konfigurierte Provider sind wählbar).
  - Modell-Dropdown, abhängig vom Provider:
    - Lovable: kuratierte Liste aus dem Knowledge-Snippet.
    - OpenRouter: `auto` + eingebaute Liste populärer/kostenloser Modelle + Freitext-Override.
    - Weitere Provider: Freitext.
  - Monaco/Textarea für System-Prompt mit „Auf Code-Default zurücksetzen"-Button.
  - Temperature, Max Tokens, JSON-Extra-Options.
  - „Test Run"-Button (ruft eine neue Edge Function `admin-test-llm-config` mit Dummy-Input).
- Reine Admin-Route, geschützt via `AdminRoute`.

### 4. Beobachtbarkeit

- `LLM Usage Log` (existierende Admin-View) bekommt zusätzlich Filter `call_site` und einen Direkt-Link „Diesen Call konfigurieren" → öffnet die Config-Zeile.
- Wenn die DB-Config fehlt/defekt ist, loggen wir `usage_source = "fallback-default"` und zeigen das in der UI.

## Aufwand / Risiko

- ~1 Migration, ~1 neuer Shared-Router, ~20 Edge Functions umverdrahten (mechanisch), ~1 Admin-Page, optional 1 Test-Edge-Function.
- Risiko: dass beim Umstellen versehentlich Verhalten kippt. Dagegen: Seed-Migration spiegelt heutige Defaults, plus Fallback-auf-Code-Default, plus „enabled=false" als Sicherheits-Off-Switch.

## Was wir **nicht** zuerst bauen

- Pro-Workspace- oder Pro-User-Overrides (erstmal global).
- Versionierung / Diff der Prompts (kann später hinzu).
- A/B-Testing zweier Modelle gegeneinander (später).

## Offene Frage an dich

1. Sollen wir die externen Provider (OpenAI, Anthropic, Gemini direkt) gleich mit anlegen — dann brauche ich, dass du in einer späteren Build-Iteration die entsprechenden API-Keys hinzufügst — oder erstmal nur **Lovable AI Gateway + OpenRouter (inkl. `auto` und `:free`-Modelle)**? Letzteres deckt deinen Use-Case ab und spart einen Bauschritt.
