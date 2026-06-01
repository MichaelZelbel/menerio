# Mistral in LLM Config integrieren

## Befund

Du hast recht — Mistral wurde übersehen. `supabase/functions/analyze-media/index.ts` ruft Mistral direkt auf (eigener `mistralFetch`-Helper), nicht über `_shared/llm-credits.ts`. Deshalb taucht es weder als Provider noch als Call-Site im neuen LLM-Config-Panel auf. `analyze-pdf` ist nur ein Wrapper um `analyze-media`.

Drei verschiedene Mistral-Endpunkte sind im Einsatz:

| Zweck | Endpoint | Modell |
|---|---|---|
| OCR (PDF, Bilder) | `POST /v1/ocr` | `mistral-ocr-latest` |
| Vision (Bildinterpretation) | `POST /v1/chat/completions` (multimodal) | `pixtral-12b-2409` |
| Text-Nachverarbeitung (Zusammenfassung etc.) | `POST /v1/chat/completions` | `mistral-small-latest` |

## Plan

### 1. Provider „mistral" im Router

`supabase/functions/_shared/llm-router.ts`:
- `Provider`-Type um `"mistral"` erweitern.
- Neuer Adapter `callMistralChat(...)` — Mistral ist OpenAI-kompatibel für Chat/Vision, also dünner Wrapper um `callOpenAICompatible` mit `https://api.mistral.ai/v1/chat/completions`.
- OCR ist **kein** Chat-Endpoint und passt nicht in `runChat`. Dafür eine separate Funktion `runOcr({ db, userId, callSite, document|image, defaults })`, die `POST /v1/ocr` aufruft, das gleiche Config-Lookup (`llm_call_configs`) nutzt und über `deductTokens` abrechnet (mit Token-Schätzung aus Seitenanzahl × Pauschale, da OCR keine echten Tokens liefert).
- Secret-Mapping in `admin-llm-config/index.ts`: `mistral → MISTRAL_API_KEY`.

### 2. Drei neue Call-Sites in `llm_call_configs`

Seed-Migration:

| call_site | provider | model | Beschreibung |
|---|---|---|---|
| `analyze-media.ocr` | mistral | `mistral-ocr-latest` | OCR für PDFs & gescannte Bilder |
| `analyze-media.vision` | mistral | `pixtral-12b-2409` | Bildinterpretation (Captions, Objekte, Szene) |
| `analyze-media.text` | mistral | `mistral-small-latest` | Nachgelagerte Textverarbeitung der OCR-Ergebnisse |

Die heutigen Default-System-Prompts aus `analyze-media/index.ts` werden 1:1 in `system_prompt` der jeweiligen Zeile übernommen, damit Verhalten gleich bleibt.

### 3. `analyze-media` umverdrahten

- Vision-Call (Zeile ~137) und Text-Call (Zeile ~164) gehen über `runChat({ callSite: "analyze-media.vision" | "analyze-media.text", ... })`.
- OCR-Calls (Zeilen ~270 und ~306) gehen über `runOcr({ callSite: "analyze-media.ocr", ... })`.
- Lokales `MISTRAL_API_KEY` / `mistralFetch` entfernen, da Router das übernimmt.
- Default-Block in jedem Call enthält Provider+Model+Prompt als Code-Fallback (gleicher Sicherheitsnetz-Mechanismus wie bei den anderen umgezogenen Functions).

### 4. Admin-UI

`LLMConfigPanel.tsx`:
- Provider-Dropdown bekommt `mistral` als Option (ausgegraut, wenn `MISTRAL_API_KEY` nicht in `availability`).
- Kuratierte Modell-Liste für Provider Mistral: `mistral-ocr-latest`, `pixtral-12b-2409`, `mistral-large-latest`, `mistral-small-latest`, `mistral-medium-latest`, plus Freitext.
- Hinweis-Badge an Call-Site `analyze-media.ocr`: „OCR-Endpoint — Chat-Parameter (temperature, max_tokens) werden ignoriert".
- „Save & Test"-Button für `analyze-media.ocr` ruft einen leichten OCR-Smoke-Test gegen ein winziges Test-PDF (oder antwortet mit „Test für OCR nicht im Chat-Modus möglich — bitte über echte Datei testen"), für die anderen beiden funktioniert der bestehende Chat-Test.

### 5. Risiko / Rollback

- Verhalten bleibt identisch, weil Seed = heutige Hardcoded-Defaults.
- `enabled=false` auf einer Zeile fällt automatisch auf den Code-Default zurück (Mistral direkt).
- Falls `MISTRAL_API_KEY` fehlt: Router wirft klaren Fehler statt stiller Falschnutzung.

## Technische Details

- Neue Files: keine. Nur Edits an `_shared/llm-router.ts`, `admin-llm-config/index.ts`, `analyze-media/index.ts`, `LLMConfigPanel.tsx` + eine Seed-Migration.
- `MISTRAL_API_KEY` ist bereits als Secret konfiguriert (analyze-media nutzt es aktuell), also kein neuer Secret-Schritt nötig.

## Offene Frage

Soll ich für `analyze-media.ocr` zusätzlich erlauben, **statt** Mistral-OCR ein Vision-Modell (z. B. Gemini 3 Flash oder GPT-4o) zu nutzen? Das wäre dann ein zweiter Code-Pfad im Router, aber gibt dir die Freiheit, OCR komplett wegzuschalten. Wenn nein, bleibt `analyze-media.ocr` Mistral-only und du steuerst nur Modell-Variante + Enable/Disable.