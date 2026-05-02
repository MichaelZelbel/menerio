## Ziel

Eine Aktion einbauen, mit der der Nutzer **alle komplett leeren Notizen** (kein Titel, kein Inhalt) in einem Schritt in den Papierkorb verschieben kann.

## Wo wird die Aktion platziert?

In **`src/pages/Notes.tsx`**, im bestehenden **Vault Insights Popover** (das `#`-Hash-Icon in der Notes-Toolbar). Direkt unter dem schon vorhandenen "Classify unclassified vault notes"-Button — gleiche Stelle, gleicher Stil. Wenn keine leeren Notizen existieren, wird der Button gar nicht angezeigt (analog zum Classify-Button).

Begründung: Das ist die zentrale Anlaufstelle für Vault-weite Aufräum-Aktionen. Kein neuer Tab in Settings, keine neue Route. Folgt dem bestehenden Muster.

## Wie wird "leer" definiert?

Eine Notiz gilt als leer, wenn **beides** zutrifft:

- **Titel leer** — leer, nur Whitespace, oder wörtlich "Untitled".
- **Inhalt leer** — nach dem Strippen von HTML-Tags, leeren Markdown-Headings (`#`), leeren List-Bullets (`- `, `* `), Horizontal Rules und allem Whitespace (inkl. `&nbsp;`) bleibt nichts übrig.

Damit fängt man auch Notizen ab, die nur unsichtbares Editor-Gerüst enthalten (häufig bei versehentlichem "+ New Note"-Klick).

**Was nicht angefasst wird:**
- Notizen mit Anhängen/Bildern (HTML enthält dann `<img>`/`<video>`-Inhalte → Body wird nicht als leer erkannt)
- Bereits getrashte Notizen (`is_trashed = true` ist nicht in `allNotes` enthalten)
- Notizen mit irgendeinem echten Text

## UI-Verhalten

- Button-Text: **"Trash N empty note(s)"** mit `Trash2`-Icon, gleicher Stil wie der Classify-Button.
- Beim Klick: native `confirm()`-Dialog ("Move N empty notes to Trash? You can restore them from the Trash filter.")
- Bei Bestätigung: Bulk-Update via einem einzigen Supabase-Statement (`update notes set is_trashed=true, trashed_at=now() where id in (...)`).
- Notes-Cache wird invalidiert, leere Notizen sind sofort weg.
- Falls die gerade geöffnete Notiz dabei ist: Auswahl wird aufgehoben.
- Toast: "Moved N empty notes to Trash". Fehlerfall → Error-Toast.

## Technische Details

**Datei:** `src/pages/Notes.tsx`

- Neuer `useMemo` `emptyNotes` (filtert `allNotes` mit dem oben beschriebenen "Empty"-Test).
- Neuer `useCallback` `handleTrashEmptyNotes` (Confirm + Bulk-Update + Cache-Invalidate + Toast).
- Neuer Lokal-State `isTrashingEmpty` für den Loading-Spinner.
- Im Vault Insights Popover, direkt nach dem Classify-Block: ein `<Button variant="outline" size="sm">` der nur gerendert wird wenn `emptyNotes.length > 0`.
- `queryClient` wird über `useQueryClient()` aus `@tanstack/react-query` geholt (Import-Erweiterung).
- Reuse: `supabase`, `showToast`, `Trash2`-Icon — alle bereits importiert.

**Kein Backend-Change.** Kein neuer Hook. Keine Migration. RLS bleibt unverändert (User darf nur eigene Notizen updaten).

## Optional (NICHT Teil dieser Iteration, falls du später willst)

- Gleiche Aktion für Trash-Filter: "Empty Trash" (alle getrashten Notizen permanent löschen). Sag Bescheid, wenn du das auch möchtest.