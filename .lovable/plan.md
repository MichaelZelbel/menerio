## Goal
Im "All Notes"-Tree (NoteTree) sollen Ordner nicht nur erstellt, sondern auch **umbenannt, verschoben (per Drag & Drop oder Kontextmenü) und gelöscht** werden können. Beim Löschen eines Ordners werden alle enthaltenen Notizen (rekursiv) wie im Datei-Manager mit verschoben/gelöscht.

## UX

**Folder-Kontextmenü** (rechtsklick auf Ordner in NoteTree) erweitern um:
- New note here *(bereits vorhanden)*
- New folder here *(bereits vorhanden)*
- ── Trennlinie ──
- **Rename folder…** → Prompt mit aktuellem Namen
- **Move to ▸** → Submenü mit "Vault root" + Liste aller anderen Ordner (analog zum Move-Submenü bei Notizen, eigener Pfad + Nachfahren ausgeschlossen)
- **Delete folder…** → Bestätigungsdialog der die Anzahl betroffener Notizen + Unterordner zeigt: *"Delete `Foo/Bar`? This will move 3 notes and 2 subfolders to Trash."*

**Drag & Drop** für Ordner:
- Ordner-Header wird `draggable`. Drop auf anderen Ordner → verschieben (als Kind). Drop auf "Vault root" → in Root verschieben.
- Self-drop und Drop auf eigene Nachfahren werden ignoriert (sonst Zyklus).
- Bestehender Note-Drop bleibt unverändert (per `dataTransfer`-Type unterscheiden: `application/x-folder-path` vs `text/plain` für Notizen).

Root-Ordner ("Vault root") kann weder umbenannt, verschoben noch gelöscht werden — diese Menüeinträge erscheinen für Root nicht.

## Datenmodell

Keine Migration nötig. `note_folders` hat bereits `path`, `name`, `parent_path` (alles `text NOT NULL`). Notizen referenzieren Ordner über `notes.folder_path` (text).

## Implementierung

### 1. `src/pages/Notes.tsx` — neue Handler
Drei neue Callbacks, alle nutzen den authentifizierten Supabase-Client + RLS:

- **`handleRenameFolder(oldPath, newName)`**
  1. Validieren: `newName` nicht leer, kein `/`.
  2. `newPath = parent_path ? parent + "/" + newName : newName`
  3. Rekursiv betroffene `note_folders` ermitteln (`path = oldPath OR path LIKE 'oldPath/%'`), für jeden Eintrag `path` + ggf. `parent_path` + `name` neu schreiben.
  4. `notes` aktualisieren: `folder_path` ersetzen, wo `folder_path = oldPath OR folder_path LIKE 'oldPath/%'` (String-Replace des Präfixes).
  5. `refreshFolders()`, `queryClient.invalidateQueries(["notes"])`. Wenn `activeFolderPath` betroffen → auf `newPath` umstellen.

- **`handleMoveFolder(sourcePath, targetParentPath)`**
  - Guard: `targetParentPath !== sourcePath` und nicht innerhalb sourcePath (`!targetParentPath.startsWith(sourcePath + "/")`).
  - Berechnet `newPath = targetParentPath ? targetParentPath + "/" + name : name`.
  - Konfliktcheck: existiert bereits ein Ordner an `newPath` → Fehler-Toast.
  - Gleiche Präfix-Rewrite-Logik wie Rename (Pfad-Update aller Nachfahren-Folders + zugehöriger Notizen).

- **`handleDeleteFolder(path)`**
  - `confirm()` mit Anzahl betroffener Notizen (aus `allNotes.filter(n => n.folder_path === path || n.folder_path.startsWith(path + "/"))`).
  - Notizen: `update({ is_trashed: true, trashed_at: now })` für alle mit passendem `folder_path` (in Trash schieben, nicht hard-delete — konsistent mit dem bestehenden Trash-Pattern und der Memory-Regel "trash über delete").
  - `note_folders` löschen: `delete().or('path.eq.PATH,path.like.PATH/%')`.
  - Wenn `activeFolderPath` betroffen → auf `parent_path` zurücksetzen.
  - Toast: "Folder deleted, N notes moved to Trash."

### 2. `src/components/notes/NoteTree.tsx`
- Props erweitern: `onRenameFolder`, `onMoveFolder`, `onDeleteFolder`.
- `FolderRow` ContextMenu erweitern (Rename/Move-Submenü/Delete) — nur für `!isRoot`.
- `FolderRow` `draggable={!isRoot}`, beim `dragstart` `dataTransfer.setData("application/x-folder-path", node.path)` setzen.
- In `handleDrop` zuerst auf `application/x-folder-path` prüfen → `onMoveFolder(sourcePath, targetPath)`. Sonst wie bisher: `text/plain` → `onMoveNote`.
- Move-Submenü für Folder analog zu dem für Notizen aufbauen (mit `flattenFolders`), aber Quelle + Nachfahren ausfiltern.

### 3. NoteTree wird in `Notes.tsx` mit den drei neuen Handlern verdrahtet.

## Offene UX-Details
- **Konflikt** beim Move/Rename auf bereits existierenden Ordner: einfach Toast-Error, kein Auto-Merge (sicherer).
- **Trash statt Hard-Delete** für Ordner-Inhalte: passt zur bestehenden Konvention (Notizen werden nie hart aus der UI gelöscht — nur über die Trash-Ansicht). Deckt die Anforderung "Notizen werden auch gelöscht" ab und bleibt rückgängig machbar.
