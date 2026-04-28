Ich habe die Editor-Logik geprüft. Die wahrscheinlichste Ursache ist ein Race Condition im NoteEditor: Beim Tippen wird nach 800 ms gespeichert, `useUpdateNote` invalidiert danach die gesamte `notes` Query, und der Editor bekommt kurz darauf wieder eine ältere/anders normalisierte `note`-Version aus dem Cache/Refetch. Der Effekt `useEffect(... note.title/note.content ...)` schreibt dann lokale Drafts zurück (`setTitle(note.title)` bzw. ggf. `setContent`) und kann die zuletzt getippten Zeichen überschreiben.

Besonders kritisch:
- Titel: `setTitle(note.title)` läuft bei jeder `note.title`-Änderung aus React Query, auch wenn der User gerade weiter tippt.
- Titel und Inhalt teilen sich denselben `saveTimer`. Ein Content-Autosave kann einen ausstehenden Title-Autosave abbrechen und umgekehrt.
- `useUpdateNote` invalidiert immer alle Notes, statt den konkreten Note-Cache optimistisch/gezielt zu aktualisieren. Dadurch kommen Refetches mitten in der Eingabe.
- Im RichTextEditor gibt es zusätzlich eine Prop-zu-Editor-Synchronisierung, die bei Value-Abweichungen `setContent` ausführt. Diese muss während aktiver Eingabe geschützt bleiben.

Plan zum Fix:

1. Titel-Draft gegen Refetch-Überschreiben schützen
- In `src/components/notes/NoteEditor.tsx` eigene Refs für den Titel einführen:
  - `lastLocalTitleRef`
  - `pendingSaveTitleRef`
  - eigener `titleSaveTimer`
- `handleTitleChange` aktualisiert Draft + Refs sofort und speichert debounced.
- Der Sync-Effekt übernimmt `note.title` nur noch, wenn:
  - wirklich eine andere Note geöffnet wurde, oder
  - kein lokaler ungespeicherter Titel existiert, oder
  - der Input nicht fokussiert ist und die Server-Version nicht gegen den lokalen Draft läuft.

2. Inhalt- und Titel-Autosave entkoppeln
- Den aktuellen gemeinsamen `saveTimer` aufteilen in:
  - `contentSaveTimer`
  - `titleSaveTimer`
- Dadurch kann Tippen im Body nicht mehr den Titel-Save abbrechen und Titel-Tippen nicht mehr den Body-Save.

3. Note-Query-Cache stabilisieren
- `useUpdateNote` in `src/hooks/useNotes.ts` so anpassen, dass nach erfolgreichem Save die betroffene Note in allen relevanten `notes` Query-Caches direkt mit der Serverantwort ersetzt wird.
- Erst danach optional invalidieren/refetchen, aber ohne dass lokale Drafts überschrieben werden.
- Ziel: Sidebar/Listen bleiben aktuell, ohne den Editor in einen alten Zustand zurückzusetzen.

4. Content-Sync während aktiver Eingabe absichern
- Den bestehenden Schutz im NoteEditor beibehalten/verschärfen: solange der Editor fokussiert ist oder `pendingSaveContentRef` gesetzt ist, darf kein serverseitiger `setContent` passieren.
- `lastLocalContentRef` nur zurücksetzen, wenn tatsächlich eine neue Note geöffnet wurde oder der Serverstand dem lokalen Stand entspricht.

5. RichTextEditor für Lexicon/Web-Node Editor schützen
- In `src/components/RichTextEditor.tsx` verhindern, dass `editor.commands.setContent(...)` läuft, während der Editor fokussiert ist.
- Falls der Parent-Value während des Tippens veraltet reinkommt, wird er ignoriert statt die letzten Zeichen zu löschen.
- Das ist relevant für den Lexicon/Web Editor (`src/pages/WikiPage.tsx`), der `RichTextEditor` nutzt.

6. Kurzer Validierungscheck
- Szenario manuell/gedanklich absichern:
  - Neue Note erstellen.
  - Schnell einen Titel tippen.
  - Direkt weiter tippen, während Autosave/Refetch läuft.
  - Zeichen bleiben sichtbar und werden gespeichert.
  - Body-Eingabe verliert ebenfalls keine letzten Zeichen.

Keine DB-Änderung nötig; es ist ein Frontend-State-/Autosave-Fix.