# Lexicon-Synthese: Verwechslung gleicher Kategorien verhindern

## Was passiert ist

Du hast eine Notiz zu einem **OpenClaw**-Agenten erfasst. Die Synthese hat daraufhin den **Hermes**-Eintrag aktualisiert und dort „Craig ist der OpenClaw-Agent des Users" hinzugefügt.

Das ist kein Zufallsfehler, sondern eine systematische Lücke in `supabase/functions/wiki-ingest/index.ts`:

1. **Subject-Grounding nur bei `create`, nicht bei `update`.** Beim Erstellen einer Seite prüfen wir, ob der Titel/Slug der Seite tatsächlich in der Notiz vorkommt (`subject_not_in_note`). Bei Updates fehlt diese Prüfung komplett — das Modell darf jede beliebige existierende Seite umschreiben, auch wenn deren Subject in der Notiz nie genannt wird.
2. **Der komplette Page-Index wird dem Modell als „Menü" präsentiert.** Alle Lexikon-Seiten (Slug, Titel, Typ, Summary) gehen ungefiltert in den System-Prompt. Sieht das Modell „hermes (entity) — AI agent" und liest dann eine Notiz über einen anderen AI-Agent, ist die Versuchung groß, dort „update" zu machen statt nichts.
3. **Schwaches Modell (gpt-4o-mini) bei einer Aufgabe, die Disambiguierung verlangt.** Bei zwei verschiedenen Systemen derselben Kategorie (beide „AI agents") fehlt dem Modell der Reasoning-Headroom.
4. **Prompt warnt vor erfundenen Fakten, aber nicht explizit vor Themenverwechslung.** „Don't add background context" ist da, aber keine Regel à la „update only pages whose subject is named in the note".

## Änderungen

### 1. `validateAction` — Subject-Check auch für Updates

In `supabase/functions/wiki-ingest/index.ts`:

- `validateAction` zusätzlich für `op === "update"` prüfen lassen, dass das Subject der Seite (Titel der existierenden Seite **oder** Slug-Words) in der Notiz vorkommt.
- Dazu Signatur erweitern: zweite Quelle für den Titel der existierenden Seite mitgeben (aus `existingBySlug`-Map). Heute kennen wir bei Updates nur `slug` aus der Action — wir lesen den echten Titel aus den existierenden Pages dazu.
- Wenn weder Titel noch Slug-Words in der Notiz vorkommen → `reason: "update_subject_not_in_note"`, Action verworfen, in `validation`-Log sichtbar.

Das hätte den Hermes-Vorfall direkt geblockt: „hermes" steht nicht in einer OpenClaw-Notiz.

### 2. Page-Index vorfiltern statt komplett dumpen

In `processIngest`, beim Bauen von `index`:

- Statt alle Pages auflisten: nur die Pages aufnehmen, deren **Titel oder Slug-Words** als Substring in der normalisierten Notiz vorkommen (gleiches `normalizeForMatch` wie schon vorhanden).
- Zusätzlich eine kleine, fest definierte Tail-Liste behalten: Seiten vom Typ `overview` und `synthesis` immer sichtbar, weil das die einzigen sind, die legitimerweise notiz-übergreifend wachsen.
- Wenn nach Filterung 0 Pages übrigbleiben, schicken wir „No matching existing pages." — das Modell soll dann nur `create` oder leere `actions` produzieren.

Das nimmt dem Modell die Verwechslungs-Versuchung an der Wurzel.

### 3. Prompt schärfen

`WIKI_SYNTHESIS_AGENT_PROMPT` bekommt einen neuen Block direkt nach „GROUND EVERY CLAIM AND EVERY LINK":

> # Never update a page about a different subject
>
> An `update` is only allowed if the page's exact subject (its title) is named in the note. Do not update a page just because the note's topic is in the same category. Two different AI agents, two different companies, two different people with similar roles are SEPARATE pages. If the note describes a new entity that doesn't have a page yet, prefer `create` (or do nothing) over twisting an existing page to fit.

Klein, aber explizit auf genau diesen Failure-Mode.

### 4. Synthese-Modell hochziehen

`OPENROUTER_MODEL` von `openai/gpt-4o-mini` auf `google/gemini-2.5-flash` umstellen (stärker bei Disambiguierung, ähnlicher Preis-Range). Temperatur bleibt bei 0.1.

Das ist eine 1-Zeilen-Änderung und betrifft nur die Lexikon-Synthese, nicht den Rest des Systems.

### 5. Logging

`validationLog`-Einträge mit dem neuen `reason: "update_subject_not_in_note"` sind automatisch im `wiki_log` sichtbar — keine zusätzliche Arbeit nötig, du kannst künftig im Admin/Postgres checken, wie oft das anschlägt.

## Was wir nicht ändern

- Keine Änderung an `wiki_apply_ingest` (RPC), `wiki_revisions`, `wiki_pages`-Schema oder Frontend-Review-Queue. Das hier ist rein Synthese-seitig.
- Kein Group-Insights-Pfad angefasst (`synthesizeGroupInsights`) — der hat das Problem nicht, weil dort die Page bereits an Group/Personen gebunden ist.
- Bestehende Lexikon-Einträge werden nicht migriert; den Hermes-Eintrag musst du einmalig in der Review-Queue „Roll Back" oder manuell bereinigen.

## Verifikation

- Build prüfen.
- Edge-Function Logs (`wiki-ingest`) nach Deploy: bei einer Test-Notiz zu einem komplett neuen Subject sollte `validation` keine fremden Slugs als „accepted" zeigen.
- Eine zweite OpenClaw-Notiz erfassen → Hermes-Eintrag darf nicht mehr touched werden; stattdessen entweder Create für `openclaw` oder leere actions.

## Optional, nicht in diesem Plan

- Eigene Aliases-Tabelle (z. B. „Hermes ≠ OpenClaw" als hartes Disambiguation-Signal) wäre Overkill für jetzt. Erst wieder anschauen, wenn das Problem nach den 4 Fixes oben weiter auftritt.
