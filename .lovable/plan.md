Ja, das bekommen wir hin. Der aktuelle Fehler liegt ziemlich klar in der bestehenden Logik:

- `Add Members from Notes` / `suggest-group-members` schaut aktuell nur auf die letzten 50 Notes als kurze Text-Snippets und bittet die AI allgemein: „Welche vorhandenen Kontakte passen zu dieser Gruppe?“
- Die Funktion nutzt nur vorhandene `contacts` als Kandidaten. Sie ist nicht darauf ausgelegt, eine konkrete Tabelle in einer Note zu erkennen, daraus neue Personen zu erstellen und sie exakt in Reihenfolge 1–100 in die Gruppe zu übernehmen.
- Deshalb findet sie nur wenige Treffer und halluziniert/greift auf vorhandene Personen zurück, die mit der konkreten Dream100-Note nicht zwingend etwas zu tun haben.

Zielverhalten:
Wenn eine Gruppe `Dream100` heißt und es eine Note wie `Dream100 Querino` gibt, soll Menerio verstehen: Das ist wahrscheinlich die Source-of-Truth-Liste für diese Gruppe. Dann soll nicht nur „vorgeschlagen“ werden, sondern die Tabelle strukturiert importiert werden können.

Plan:

1. Source-Note gezielt finden statt nur „recent notes“ nutzen
- `suggest-group-members` erweitert die Suche nach relevanten Notes:
  - Titel enthält Gruppenname, z. B. `Dream100`
  - Titel enthält optional Projekt-/Kontextbegriffe aus Gruppe oder Note, z. B. `Querino`
  - hohe Priorität für Markdown-Tabellen mit Spalten wie `Creator`, `Link`, `Warum relevant`, `First Step`, `#`
- Wenn genau eine starke Source-Note gefunden wird, nutzt die Funktion diese gezielt.
- Wenn mehrere mögliche Notes gefunden werden, sollte die UI später auswählbar machen, welche Note importiert werden soll.

2. Tabellen-Import deterministisch machen
- Nicht die AI frei raten lassen, sondern zuerst die Markdown-Tabelle aus der Note parsen.
- Pro Tabellenzeile extrahieren:
  - Rang / Position (`#`)
  - Name (`Creator`)
  - Link
  - Relevanz-Begründung
  - konkreter erster Schritt
- Die Reihenfolge aus der Tabelle wird als `contact_group_memberships.position` gespeichert.

3. Personen automatisch anlegen oder matchen
- Für jeden Namen aus der Tabelle:
  - vorhandene Person per exaktem/fuzzy Name-Match suchen
  - wenn nicht vorhanden: neue Person in `contacts` erstellen
- Link und Kontext speichern:
  - Link in Contact-Metadaten oder Notizen
  - Relevanz + First Step in Membership-Notizen/Reason/Attributes
- Optional zusätzlich für den First Step ein Action Item erzeugen, damit der User direkt handlungsfähig ist.

4. Review-Queue-Verhalten beibehalten
- Die Funktion respektiert weiterhin deine AI-Suggestion-Settings:
  - Auto-Modus: Mitglieder werden direkt hinzugefügt, aber als `auto_applied_unreviewed` in der Review Queue dokumentiert, damit du widersprechen/rollbacken kannst.
  - Manual-Modus: Import landet erst als Vorschläge in der Review Queue.
- Wichtig: Bei einem expliziten Tabellenimport aus einer User-Note ist die Confidence sehr hoch, weil die Quelle eindeutig ist.

5. Button/UX präzisieren
- Der Button bleibt sinngemäß `Add Members from Notes`, aber die Success-Meldung wird genauer:
  - „Imported 100 members from Dream100 Querino“
  - oder „100 suggestions added to Review Queue“
- Optional: Wenn eine passende Note gefunden wurde, zeigen wir vorher einen kleinen Dialog:
  - Source note: `Dream100 Querino`
  - erkannte Zeilen: 100
  - Checkbox: `Create missing people`
  - Checkbox: `Create first-step action items`
  - Button: `Import members`

6. MCP/Chat-AI aufbohren
Aktuell hat der MCP Server zwar Group-Tools (`add_group_member`, `add_members_from_notes`), aber noch keinen präzisen Bulk-Import nach dem Muster: „Nimm diese 100 Zeilen aus dieser Note und lege sie in genau dieser Reihenfolge in die Gruppe.“

Ich würde ergänzen:
- `import_group_members_from_note`
  - Input: `group_id_or_slug`, optional `note_id_or_title`, `create_missing_people`, `create_action_items`, `mode`
  - Macht denselben deterministischen Tabellenimport wie der UI-Button.
- `preview_group_members_from_note`
  - Gibt vorab zurück: erkannte Personen, bestehend/neu, Position, Link, Reason, First Step.

Damit kann eine externe AI mit MCP dann genau sagen:
„Importiere die 100 Personen aus der Note Dream100 Querino in die Gruppe Dream100 in Tabellenreihenfolge.“

7. Bestehende AI-Suggestion verbessern, aber nicht als einzigen Weg nutzen
- Für freie, unstrukturierte Notes bleibt `Add Members from Notes` als AI-Vorschlagsfunktion sinnvoll.
- Für strukturierte Listen wie Dream100 sollte der neue Tabellenimport Vorrang haben.
- Dadurch vermeiden wir Halluzinationen und bekommen exakt die 100 Personen in der richtigen Reihenfolge.

Technische Änderungen:
- `supabase/functions/suggest-group-members/index.ts`
  - Source-Note-Erkennung
  - Markdown-Tabellenparser
  - Match/Create Contacts
  - Membership-Insert mit `position`
  - Review-Queue-Einträge mit Rollback-Daten
- `supabase/functions/open-brain-mcp/index.ts`
  - neue MCP Tools `preview_group_members_from_note` und `import_group_members_from_note`
  - bestehendes `add_members_from_notes` entweder intern auf dieselbe Logik umstellen oder als fuzzy Vorschlagsmodus behalten
- ggf. gemeinsame Helper-Datei für Parser/Import-Logik, damit UI-Funktion und MCP exakt dasselbe Verhalten haben
- `src/pages/GroupDetail.tsx`
  - Button/Dialog und präzisere Erfolgs-/Fehlermeldungen

Empfehlung:
Ich würde nicht versuchen, diese Dream100-Liste über „freie AI Suggestions“ zu lösen. Der richtige Weg ist: AI darf helfen, die passende Source-Note zu erkennen, aber der Import selbst sollte deterministisch aus der Tabelle passieren. Dann ist es schnell, zuverlässig, rollbackfähig und auch über MCP/Chat-AI steuerbar.