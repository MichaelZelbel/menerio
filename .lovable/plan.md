## Ziel

1. Buttons (`Cleanup`, `Strip dead links`, `Run lint`) aus dem Lexicon-Header entfernen — Wartung läuft im Hintergrund.
2. Manuell editierte Inhalte innerhalb einer Lexicon-Seite werden von der AI nicht mehr überschrieben. AI darf weiterhin neue Sektionen ergänzen, darf aber bestehende, vom User bearbeitete Sektionen nicht ändern.

## Konzept: Sektions-basierter Schutz

Lexicon-Seiten sind Markdown mit `##`-Sektionen. Wir markieren einzelne Sektionen als „user-owned", sobald der User sie bearbeitet. Die AI darf:
- Neue Sektionen anhängen.
- Sektionen, die noch nie vom User bearbeitet wurden, weiterhin updaten.
- User-owned Sektionen niemals modifizieren oder löschen.

Falls der User Inhalte außerhalb von Headings ändert (z. B. Intro), wird die gesamte Intro-Region (Text vor erster `##`) als user-owned markiert.

### Datenmodell

Migration auf `wiki_pages`:
- `protected_sections text[] default '{}'` — Liste der geschützten Section-Slugs (z. B. `["intro", "known-facts", "open-questions"]`). `intro` ist der spezielle Slug für Inhalt vor der ersten Überschrift.

### UI: `src/pages/WikiPage.tsx`

Beim Speichern einer manuellen Bearbeitung (`saveMutation`):
1. Diff zwischen `page.content` (vorher) und `latestMarkdownRef.current` (nachher) auf Sektions-Ebene berechnen (kleines Helper-Modul `src/lib/wiki-sections.ts`: parse `##`-Headings → `{slug, body}[]`).
2. Alle Sektionen, deren Body sich geändert hat oder die neu hinzugefügt wurden, in `protected_sections` aufnehmen (additiv, also bestehende Schutzmarkierungen bleiben).
3. `protected_sections` zusammen mit `content` und `title` an `wiki_pages` schreiben.

Optional kleines visuelles Signal pro Sektion (Lock-Icon nach `##`-Heading), wenn `protected_sections` den Slug enthält — als kleiner Hinweis im View-Mode.

### Backend: `supabase/functions/wiki-ingest/index.ts`

Vor jedem Update einer existierenden Page:
1. `protected_sections` der Zielseite laden.
2. Vom LLM gelieferten neuen Content in Sektionen splitten.
3. Für jede geschützte Sektion: Body aus dem aktuellen `wiki_pages.content` übernehmen (LLM-Version verwerfen).
4. Wenn LLM eine geschützte Sektion komplett weglässt → aus altem Content rekonstruieren und behalten.
5. Neue Sektionen, die LLM hinzufügt und die noch nicht existieren, werden übernommen.
6. Resultat in `wiki_apply_ingest` speichern (RPC bleibt unverändert; Merging passiert im Edge Function).

Gleiche Logik für den Group-Insights-Block (Zeile 369–443): Wenn `## Insights` in `protected_sections` ist → nicht überschreiben.

### Hintergrund-Wartung statt UI-Buttons

- `WikiHome.tsx`: Header reduziert auf Titel + Beschreibung + Suche. Buttons + Cleanup-Dialog entfernen.
- Neuer pg_cron-Job (täglich 03:00 UTC) ruft `wiki-cleanup` mit `mode: "strip_dead_links"` für jeden User auf.
  - Dafür neue interne Edge Function `wiki-maintenance-scheduled` (Service-Role, iteriert über User mit Lexicon-Pages, ruft die Strip-Logik auf).
  - `pg_cron`-Eintrag via Insert (nicht Migration).
- Routen `/lexicon/lint` und `wiki-cleanup` Function bleiben erhalten (nicht mehr verlinkt; weiter via Direkt-URL erreichbar für Debugging).

## Geänderte Dateien

- DB-Migration: `wiki_pages.protected_sections text[]`
- `src/lib/wiki-sections.ts` *(neu)* — Markdown-Sektion-Parser + Diff
- `src/pages/WikiPage.tsx` — Diff bei Save, `protected_sections` updaten, optional Lock-Icon
- `src/pages/WikiHome.tsx` — Buttons + Dialog entfernen
- `supabase/functions/wiki-ingest/index.ts` — Sektions-Merge, geschützte Sektionen respektieren
- `supabase/functions/wiki-maintenance-scheduled/index.ts` *(neu)* — täglicher Strip-dead-links-Run
- `pg_cron`-Insert für täglichen Run

## Edge-Cases

- User editiert Intro (Text vor erster `##`): wird als `intro` geschützt.
- User löscht eine Sektion komplett: Sektion bleibt aus `protected_sections` raus → AI darf sie wieder ergänzen, falls sie aus Notizen folgt. (Falls du das anders willst, kann ich „gelöschte Sektionen permanent ausschließen" ergänzen.)
- User benennt eine Sektion um (`## Foo` → `## Bar`): Schutz für `bar` wird gesetzt; alter Schutz für `foo` bleibt im Array, schadet aber nicht (Sektion existiert nicht mehr).

## Resultat

- Lexicon-Header ist clean — keine Maintenance-Buttons mehr.
- Was du in einer Lexicon-Seite editierst, bleibt erhalten — AI ergänzt drumherum, ohne deine Änderungen anzufassen.
- Tote Wikilinks werden nachts automatisch entfernt.
