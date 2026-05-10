## Aktuelle Situation

Heute gibt es nur **eine** Möglichkeit, im Editor eine andere Notiz zu verlinken: Du tippst `[[` und das `WikilinkAutocomplete`-Dropdown öffnet sich, in dem du suchen, auswählen oder eine neue Notiz anlegen kannst. Einen sichtbaren Button in der Toolbar gibt es bisher nicht — viele Nutzer entdecken die Funktion deshalb nie.

Der Autocomplete-Mechanismus selbst ist bereits vollständig vorhanden (`WikilinkAutocomplete`, `WikilinkExtension`, Position-Tracking, `insertWikilinkSafely`, "Notiz anlegen"-Pfad). Es fehlt nur ein UI-Auslöser.

## Vorschlag

Einen **"Notiz verlinken"**-Button in die Editor-Toolbar (`EditorToolbar.tsx`) aufnehmen, direkt neben dem bestehenden Link-Button (für externe URLs). Klick öffnet exakt dasselbe `WikilinkAutocomplete`-Popover, das auch beim Tippen von `[[` erscheint — an der aktuellen Cursor-Position.

### Verhalten
- **Icon:** `FileText` oder `Link2` von lucide-react, mit Tooltip "Notiz verlinken (oder `[[` tippen)".
- **Klick:** Öffnet das bestehende `WikilinkAutocomplete` an der Cursor-Position.
- **Dropdown:** Suche tippen → Notiz auswählen (Enter/Klick) → Wikilink wird an Cursor eingefügt. Wenn keine passende Notiz existiert, gibt es weiterhin den "Create: …"-Eintrag.
- **Esc / Klick außerhalb:** schließt das Popover, ohne etwas einzufügen.
- Nichts ändert sich am Tipp-Trigger `[[` und am bestehenden Speicher-/Resolve-Verhalten.

### Technische Umsetzung
- `EditorToolbar` bekommt eine neue optionale Prop `onInsertWikilink?: () => void`.
- Wenn gesetzt, wird der neue Button gerendert (sonst unsichtbar — relevant für andere Editor-Instanzen wie `RichTextEditor`).
- `NoteEditor.tsx` reicht eine Funktion durch, die intern denselben Pfad wie `onOpenAutocomplete` der `WikilinkExtension` benutzt: aktuelle Caret-Position bestimmen, `setWikilinkPos` + `wikilinkInsertPos.current` setzen, `setWikilinkOpen(true)`.
- Keine Änderungen an Datenmodell, Edge Functions oder Markdown-Konvertierung.

### Out of Scope
- Kein neues separates Dialog-/Modal-UI — wir verwenden bewusst das vorhandene Autocomplete für ein konsistentes Erlebnis.
- Keine Änderung am Verhalten externer Links (Link-Button bleibt für URLs).
