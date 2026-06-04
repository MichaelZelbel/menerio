
# Plan: Robustere Profil-Extraktion aus Timeline-Momenten

Ziel: Vorschläge wie „Add to Yumei's profile: Discord banner update = michael's pet" verhindern. Alle Änderungen leben in `supabase/functions/_shared/moment-profile-extraction.ts` (plus eine kleine Confidence-Konstante).

## 1. Heuristischer Pre-Filter (vor dem LLM-Call)

Neue Funktion `isLikelyEventOnlyMoment(moment)` – wenn `true`, früher Return mit `skipped_reason: "event_only_moment"` und 0 LLM-Cost.

Trigger:
- Titel matcht (case-insensitive, Wortgrenzen) ein Verb aus einer Blocklist: `adds, added, posts, posted, mentions, mentioned, tags, tagged, likes, liked, comments, commented, replies, replied, shares, shared, follows, followed, dms, messaged, texts, texted, calls, called, visits, visited, met, meets, hangs, hung out, sees, saw, watched, played, attended, joined (call/meeting), pings, pinged`.
- UND der Titel enthält keine starken biographischen Marker: `moved to, lives in, works at, joined <Company> as, promoted to, married, engaged, divorced, born, birthday, graduated, founded, started at, left <Company>, hired at`.

Damit greift „Yumei adds Michael to her Discord banner" sofort.

## 2. Label-Allowlist (statt freier Labels)

Konstante `ALLOWED_PROFILE_LABELS` (lowercase, pro Kategorie-Slug optional), z. B.:
- identity: `date of birth, pronouns, nationality, languages`
- location: `current city, current country, hometown, home address`
- professional: `job title, company, employer, industry, started role`
- education: `school, university, degree, field of study, graduation year`
- relationships: `partner, spouse, children, siblings, parents`
- (etc. — kompakte, stabile Liste pro Kategorie)

Im Prompt: Die Allowlist wird inline aufgeführt und das Modell muss exakt einen dieser Labels wählen.

Post-Filter: Falls Label nicht in Allowlist → Vorschlag verwerfen (nicht in Review Queue).

## 3. Substring-Verifikation des Werts

Nach dem LLM-Parsing, vor dem Suppress/Insert:

```ts
const sourceText = `${moment.title} ${moment.description ?? ""}`.toLowerCase();
if (!sourceText.includes(value.toLowerCase())) {
  // Erlaubte Ausnahmen:
  // - Geburtsdatum berechnet aus „Nth birthday"
  // - Wert ist normalisierte Version eines im Text vorhandenen Tokens (lockerer fuzzy: ≥80 % Tokens des Werts kommen im Text vor)
  drop();
}
```

Eliminiert „michael's pet" sofort, weil „pet" nicht im Quelltext steht.

Spezialfall Geburtsdatum bleibt erhalten via expliziter `label === "date of birth"`-Branch.

## 4. Confidence-Cap senken

`MANUAL_MOMENT_CONFIDENCE_CAP`: **0.7 → 0.6**.

Damit landen alle Vorschläge aus manuellen Momenten zuverlässig in `pending_review` (Auto-Apply-Schwellen für `balanced` sind 0.65 bzw. 0.7) und werden nie still angewendet.

Dokument-gestützte Momente (mit `moment_provenance`) bleiben unverändert bei den Standard-Defaults.

## 5. Prompt-Verschärfung

Im `MOMENT_PROFILE_EXTRACTION_PROMPT`:

- Zusätzliche Negativbeispiele:
  - „Yumei adds Michael to her Discord banner" → `{facts: [], relationships: []}`
  - „Tom posted about his vacation" → `[]`
  - „Anna tagged me in a photo" → `[]`
  - „Karim mentioned Lina in his story" → `[]`
- Neue harte Regeln:
  - „The `value` MUST appear verbatim (case-insensitive) in the moment title or description, OR be a date computed from an explicit Nth-birthday phrase. If you cannot point to the exact substring, return an empty array."
  - „The `label` MUST be one of the labels in the allowed list for the chosen category. If no allowed label fits, skip the fact."
  - „If the moment describes a one-time action by or about a participant (verbs: adds, posts, tags, mentions, likes, comments, messages, called, visited, met, hung out, watched, played, attended), return empty arrays unless the same moment ALSO contains an explicit ongoing-attribute clause (e.g. 'Tom, now Head of Design at Notion, posted ...')."

## 6. Logging / Beobachtbarkeit

`console.log` ergänzen für:
- `[moment-extract] pre-filter skipped: event-only verb` (mit Moment-ID + Titel)
- `[moment-extract] post-filter dropped: value not in source` (mit Label/Value)
- `[moment-extract] post-filter dropped: label not in allowlist`

So sehen wir in den Edge-Function-Logs, wie viele Halluzinationen wir abfangen.

## 7. Bestehende fehlerhafte Einträge

Einmaliger Cleanup-Schritt (manuell, kein neuer Code): Du wirst die bestehenden falschen `add_profile_entry`-Vorschläge in der Review Queue einfach dismissen. Wir bauen dafür keinen Migrations-Hack.

## Geänderte Dateien

- `supabase/functions/_shared/moment-profile-extraction.ts` — alle obigen Änderungen
- (kein UI-Change, kein Migration nötig)

## Verifikation

Nach dem Deploy testest du:
1. Neuer Moment „Yumei adds Michael to her Discord banner" → keine Suggestion (Pre-Filter).
2. Neuer Moment „Sarah moved to Lisbon" (mit Sarah als Teilnehmerin) → Suggestion `Current city = Lisbon`, in Review Queue, nicht auto-applied.
3. Neuer Moment „Tom's 30th birthday" am 2025-04-10 → Suggestion `Date of birth = 1995-04-10` (Sonderfall greift trotz fehlendem Substring).
4. Edge-Function-Logs zeigen die neuen `pre-filter` / `post-filter` Log-Zeilen.
