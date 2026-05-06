## Problem

Wenn eine Notiz in den Trash verschoben wird (`is_trashed: true`), bleibt sie in der "All Notes"-Liste sichtbar (mit Trash-Icon, oben einsortiert), bis die Liste neu geladen wird. Das wirkt wie ein Klick-Icon und verwirrt.

## Ursache

In `src/hooks/useNotes.ts` (`useUpdateNote.onSuccess`):
- `setQueriesData` **merged** die aktualisierte Notiz in alle gecachten Listen — auch in `["notes", "all"]` und `["notes", "favorites"]`. Die Notiz wird also mit `is_trashed: true` in den Listen weitergeführt.
- `invalidateQueries({ refetchType: "inactive" })` refetcht nur inaktive Queries; die gerade sichtbare "All Notes"-Query wird nicht neu geladen.

Die DB-Query selbst filtert korrekt (`.eq("is_trashed", false)` für all/favorites) — nur der lokale Cache hinkt hinterher.

## Lösung

In `useUpdateNote.onSuccess` den Cache-Merge serverseitig konsistent halten:

1. Beim Mergen pro Query-Key prüfen: Wenn der Query-Filter "all" oder "favorites" ist und die aktualisierte Notiz `is_trashed === true` hat → die Notiz **aus dem Array entfernen** statt zu mergen.
2. Wenn der Filter "trash" ist und `is_trashed === false` (Restore) → ebenfalls entfernen.
3. Optional spiegelbildlich: bei "favorites" und `is_favorite === false` → entfernen.

Damit verschwindet die Notiz unmittelbar aus "All Notes" beim Move-to-Trash, taucht sofort in "Trash" auf, und beim Wiederherstellen umgekehrt — ohne Refetch-Wartezeit.

Keine UI-Änderungen nötig. Das Trash-Icon im `NoteTree`/`NoteList` bleibt für den Trash-Filter erhalten (dort ist es korrekt als Status-Badge).

## Betroffene Datei

- `src/hooks/useNotes.ts` — `useUpdateNote.onSuccess` Cache-Logik anpassen (Query-Key inspizieren, statt blind zu mergen).
