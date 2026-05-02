## Problem

Beim Klippen von Webseiten (SingleFile, Telegram-Forwards, Discord-Captures, etc.) extrahiert der LLM **alle** im Text erwähnten Personennamen — Testimonial-Autoren, fiktive Beispielfiguren ("Jordan macht einen Trip"), CEOs, Autorenzeilen. `process-note` erstellt daraus blind `add_contact`-Vorschläge im Review Queue, die bei Sensitivität "balanced" (Threshold 0.7) und Default-Confidence 0.8 sogar **auto-appliziert** werden.

Heutige Schutzmaßnahmen (Hallucination-Check `nameAppearsInText`, Levenshtein-Fuzzy-Match) verhindern nur Erfindungen, nicht aber **irrelevante echte Namen** aus Fremdtexten.

## Lösungsansatz: 3 Filter-Layer + 1 Default-Änderung

### 1. Source-Aware Confidence-Dämpfung (zentrale Maßnahme)

In `process-note/index.ts` (`generateReviewItems`): Confidence von `add_contact` und `add_alias` runterstufen, wenn die Note von einer **fremdgenerierten Quelle** stammt.

```text
Note-Source                    | add_contact base conf | nach Dämpfung
-------------------------------|-----------------------|----------------
manual / quick-capture / slack | 0.80                  | 0.80 (unverändert)
telegram / discord (forward)   | 0.80                  | 0.55
singlefile / web_clip          | 0.80                  | 0.40
github sync                    | 0.80                  | 0.55
```

Bei "balanced" (0.7) und "conservative" (0.85) wird damit aus Web-Clips **nichts mehr auto-appliziert** — alles landet im Review Queue mit "low confidence"-Label. Bei "exploratory" (0.55) bleiben Telegram/Discord auto-applizierbar, Web-Clips nicht.

Source wird aus `metadata.source` bzw. `source_app` der Note gelesen (bereits vorhanden, siehe `singlefile-capture` setzt `source_app: "singlefile"`).

### 2. Mention-Strength-Heuristik

Pro extrahiertem Namen einen einfachen Score berechnen, **bevor** ein Suggestion erzeugt wird. Vorschlag wird gedroppt (oder zusätzlich gedämpft), wenn Score zu niedrig.

Signale (alle billig, ohne LLM):
- **Mention-Frequency**: Name kommt nur 1× im Text vor → schwach. ≥2× → ok.
- **Position**: Name nur in "Testimonial"-/"Author"-/"CEO"-/"Founder"-/"Quote"-Kontext (Wort im 30-Zeichen-Umfeld) → schwach.
- **Possessive/Relational Marker im Umfeld**: "my friend", "we met", "called", "wrote me", "asked me", "I/me + Name" → stark. Wenn keiner dieser Marker existiert UND Source = web_clip → droppen.
- **Density-Ratio**: bei sehr langen Notes (>5000 Zeichen, typisch Web-Clip) und nur 1 Mention → droppen.

Implementiert als `scorePersonMention(name, text, source)` → returnt `{ score: 0..1, drop: boolean }`. Bei `drop=true` wird kein Suggestion erzeugt; sonst wird Score in Confidence eingerechnet (`confidence = base * source_factor * mention_score`).

### 3. Stoppliste für offensichtliche Web-Artefakte

Kleine eingebaute Liste (englisch + deutsch) klassischer Beispielnamen + Marketing-Klischees, die in Demo-Texten auftauchen:
- "John Doe", "Jane Doe", "Max Mustermann", "Erika Mustermann", "Lorem Ipsum"
- Optional erweiterbar via `ai_suggestion_preferences.person_blocklist` (text[]) — Nutzer kann eigene Namen blockieren ("Jordan" im Menerio-Demo).

Treffer → Suggestion komplett überspringen (kein Review-Eintrag).

### 4. Default-Anpassung: Auto-Apply NICHT für `add_contact`

`prepareSuggestionForInsert` lässt aktuell `add_contact` auto-applizieren wenn Confidence ≥ Threshold. Vorschlag: **`add_contact` IMMER in `pending_review` halten**, unabhängig von Confidence. Andere Suggestion-Typen (`add_alias`, `add_profile_entry`, `add_relationship`) bleiben wie bisher, weil sie an einen bereits bestätigten Kontakt anknüpfen.

Begründung: Ein neuer Kontakt ist eine "Identity-Decision" — der irreversibelste/sichtbarste Eintrag im Notebook. Auto-Apply bringt hier wenig Tempo-Vorteil aber viel Aufräum-Aufwand.

## Technische Details

**Datei-Änderungen:**
- `supabase/functions/process-note/index.ts`:
  - Neuer Helper `getSourceConfidenceFactor(metadata)` → Faktor 0.4..1.0
  - Neuer Helper `scorePersonMention(name, fullText, sourceFactor)` → `{score, drop, reason}`
  - Neue Konstante `GENERIC_PERSON_NAMES` (Stoppliste)
  - Loop in `generateReviewItems`: Vor jeder `add_contact`/`add_alias`-Suggestion Score berechnen, dropen oder Confidence anpassen
  - `prepareSuggestionForInsert`: für `suggestion_type === "add_contact"` immer `pending_review` zurückgeben
- `supabase/functions/singlefile-capture/index.ts`: sicherstellen, dass `metadata.source = "web_clip"` gesetzt ist (bereits "singlefile" — wird im Helper berücksichtigt)

**DB-Änderung (optional, klein):**
- `ai_suggestion_preferences.person_blocklist text[] default '{}'` — Nutzer-eigene Stoppliste
- UI-Erweiterung in den Settings würde **nicht** Teil dieser Iteration sein, kann nachgereicht werden — Backend liest die Spalte schon.

**Kein UI-Eingriff in Review Queue** nötig: bestehende "low confidence"-Anzeige wird automatisch häufiger erscheinen.

## Erwartetes Verhalten nach Deployment

| Szenario                                              | Heute             | Danach                                |
|-------------------------------------------------------|-------------------|---------------------------------------|
| Web-Clip Grammarly-Homepage, "Janine Anderson" 1×     | Auto-add Contact  | Komplett verworfen (drop)             |
| Web-Clip Menerio, "Jordan" in Demo-Text               | Auto-add Contact  | Drop (single mention, kein "I/me")    |
| Web-Clip Blog-Artikel über Person X (5 Mentions)      | Auto-add Contact  | Pending Review, Confidence ~0.4       |
| Quick-Capture "Hatte heute Mittag mit Lisa gesprochen"| Pending Review    | Pending Review (unverändert)          |
| Telegram-Forward "Anna hat Geburtstag"                | Auto-add Contact  | Pending Review (Source-Dämpfung)      |
| Slack-Capture vom Brain-Owner selbst                  | Auto-add Contact  | Auto-add (Source = trusted)           |

Falls dir das zu aggressiv ist, können wir Schritt 4 (Auto-Apply abschalten) auch weglassen oder per Setting umschaltbar machen — sag Bescheid.