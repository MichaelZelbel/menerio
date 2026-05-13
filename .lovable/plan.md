# Tastatur-Hints aus Notes-Tree entfernen

Die Shortcut-Hints im Folder- und Note-Kontextmenü entfernen, weil sie nicht zuverlässig funktionieren und mit Radix' eingebautem Typeahead kollidieren (z. B. „M" highlightet nur den „Move to"-Eintrag, statt zu verschieben).

## Änderungen in `src/components/notes/NoteTree.tsx`

1. **Folder-Kontextmenü**
   - `onKeyDown`-Handler am `ContextMenuContent` entfernen.
   - Alle `<ContextMenuShortcut>`-Elemente entfernen (`N`, `⇧N`, `R`, `M`, `⌫`).

2. **Note-Kontextmenü**
   - `onKeyDown`-Handler am `ContextMenuContent` entfernen.
   - Alle `<ContextMenuShortcut>`-Elemente entfernen (`⌘C`, `R`, `⌘⌫`, `M`).

3. **Imports**
   - `ContextMenuShortcut` aus dem Import-Block entfernen, da nicht mehr verwendet.

4. **Backlog**
   - In `docs/UX_BACKLOG.md` Item 15 von „done" auf „reverted" markieren mit kurzer Notiz, warum (Typeahead-Konflikt, halb-funktionale Handler).

## Was unverändert bleibt
- Klick-Bedienung des Kontextmenüs (Rechtsklick → Eintrag wählen) bleibt voll funktional.
- Radix-Typeahead bleibt aktiv (das ist Standard und nicht abschaltbar ohne Eingriff in die Library) — aber ohne irreführende Hints fällt es kaum noch auf.
- Globale App-Shortcuts (z. B. `⌘⇧K` für AI-Chat) bleiben unberührt.

## Verifikation
- Build prüfen.
- Im Preview Rechtsklick auf Notiz und Folder testen: keine Shortcut-Symbole mehr sichtbar, Klick-Aktionen funktionieren weiter.