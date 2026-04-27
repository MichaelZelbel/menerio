Plan: Obsidian-ähnliche Navigation für Notes

Ich baue die linke Notes-Spalte so um, dass Ordner und Notizen direkt als Baum sichtbar sind, statt Ordner nur über ein separates Popover zu filtern.

Umsetzung

1. Ordnerbaum in der Notes-Sidebar
- Die linke Notes-Liste zeigt künftig:
  - eine Root-Zeile/Vault-Root für Notizen ohne Ordner
  - alle bestehenden `note_folders`
  - verschachtelte Ordner über `parent_path`
  - Notizen unter ihrem jeweiligen Ordner
- Ordner sind auf- und zuklappbar.
- Notizen werden wie in Obsidian kompakter dargestellt: nur Titel, optional kleine Status-Icons wie Pin/Favorit/Trash, keine Inhaltsvorschau mehr.
- Die ausgewählte Notiz bleibt visuell markiert.

2. Toolbar über dem Baum
- Die obere Toolbar bleibt kompakt und erhält Obsidian-ähnliche Aktionen:
  - neue Notiz
  - neuer Ordner
  - Suche
  - Filter/Sortierung/Insights wie bisher
- Die bisherige Folder-Auswahl als Popover/Filter wird entfernt oder deutlich zurückgestuft, damit sie nicht mehr zwischen Titel und Tools „herumhängt“.

3. Ordner erstellen
- Neuer-Ordner-Button öffnet einen kleinen Dialog/Popover.
- Wenn gerade ein Ordner ausgewählt ist, wird ein neuer Ordner standardmäßig darin angelegt.
- Ordner werden weiterhin in der vorhandenen Tabelle `note_folders` gespeichert.

4. Notizen in Ordnern erstellen
- Rechtsklick auf einen Ordner bietet „New note in folder“.
- Alternativ erstellt der normale New-Note-Button eine Notiz im aktuell ausgewählten/aktiven Ordner, falls vorhanden.
- Neue Notizen bekommen automatisch das passende `folder_path`.

5. Notizen verschieben
- Per Rechtsklick auf eine Notiz gibt es „Move to…“ mit Root und vorhandenen Ordnern.
- Zusätzlich unterstütze ich Drag & Drop von Notizen auf Ordner bzw. Root, sofern es mit der bestehenden UI sauber bleibt.
- Das Verschieben aktualisiert `notes.folder_path` und invalidiert die Notes-Queries, damit Baum und Editor sofort aktualisieren.

6. Folder-Feld im Editor entfernen
- Das aktuelle Eingabefeld unter dem Notiztitel für `folder_path` wird entfernt.
- Der Editor zeigt stattdessen höchstens eine dezente Breadcrumb/Folder-Anzeige, nicht als primäre Bearbeitungsbox.
- Ordnerarbeit passiert in der linken Navigation.

7. Such- und Filterverhalten
- Im Suchmodus bleibt eine flache Ergebnisliste sinnvoll, weil Suchergebnisse aus verschiedenen Ordnern kommen können.
- Außerhalb der Suche wird der Ordnerbaum angezeigt.
- Bestehende Filter wie Favorites/Trash, Typfilter, Tags/Insights und Sortierung bleiben erhalten.

Technische Details

- Betroffene Dateien voraussichtlich:
  - `src/pages/Notes.tsx`
  - `src/components/notes/NoteList.tsx` oder eine neue Komponente wie `NoteTree.tsx`
  - `src/components/notes/NoteEditor.tsx`
  - ggf. `src/hooks/useNotes.ts` für kleine Hilfsfunktionen/Typen
- Keine neue Datenbankmigration nötig: `notes.folder_path` und `note_folders` existieren bereits.
- Ich nutze vorhandene shadcn-Komponenten (`ContextMenu`, `Popover`, `Input`, `Button`, `Collapsible`) und bestehende Supabase-Queries.
- RLS bleibt unverändert; alle Schreiboperationen laufen über bestehende user-scoped Tabellen.

Validierung

- TypeScript Build/Lint prüfen.
- Manuell prüfen:
  - Ordner erstellen
  - Ordner auf-/zuklappen
  - Notiz im Ordner erstellen
  - Notiz in anderen Ordner und Root verschieben
  - Suche zeigt weiterhin Ergebnisse
  - Editor speichert Titel/Inhalt weiter korrekt
  - externe/trashed Notes bleiben geschützt wie bisher