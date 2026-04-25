Ja, genau: Wenn wir wirklich Obsidian-kompatibel sein wollen, sollten wir Obsidian nicht technisch überinterpretieren. Obsidian ist im Kern ein Dateisystem-Vault:

```text
Vault/
  Folder A/
    My Note.md
  Folder B/
    My Note.md
```

Daraus folgt:

- Unique ist nicht der Titel global, sondern der Dateipfad.
- Zwei Notes mit gleichem Dateinamen im selben Ordner gehen nicht.
- Zwei Notes mit gleichem Namen in unterschiedlichen Ordnern gehen sehr wohl.
- Ordner sind Nutzerstruktur, nicht App-Automatik.

Meine aktualisierte Empfehlung

Wir sollten in Menerio ebenfalls eine nutzerkontrollierte Ordnerstruktur einführen und die GitHub-/Obsidian-Sync-Logik daran koppeln:

```text
Menerio Note
  title: "Meeting"
  folder_path: "Projects/Menerio"

GitHub/Obsidian path
  Projects/Menerio/Meeting.md
```

Die Hauptlisten, Suche, AI-Verarbeitung und Knowledge Graph bleiben davon unabhängig. Ordner sind eine zusätzliche Navigations- und Sync-Ebene, nicht das primäre Datenmodell.

Zur Frage „Titel unique verlangen?“

Ich würde es so machen:

- Innerhalb desselben Ordners: ja, wir behandeln gleiche Titel als Konflikt bzw. als bewusst zu bestätigende Ausnahme.
- Global über alle Ordner: nein, das wäre weniger Obsidian-like.
- Intern in der Datenbank: keine harte globale Unique Constraint auf `notes.title`, weil das Suche, Imports und externe Syncs unnötig einschränken würde.

Plan: Obsidian-kompatible Ordner und Titelkonflikte

1. Ordnerstruktur für Notes einführen
   - Jede Note erhält einen optionalen `folder_path` bzw. eine Obsidian-kompatible Pfadangabe.
   - Standard ist der Vault-Root oder ein Nutzerordner wie `Inbox`.
   - Nutzer können Ordner selbst anlegen, umbenennen und löschen.
   - Notes können zwischen Ordnern verschoben werden.
   - Die bestehende Notes-Liste und Suche bleiben unverändert; zusätzlich kommt eine Folder-Navigation.

2. Datenmodell schlank halten
   - Keine automatische Monats-/Datumsstruktur als Default.
   - Keine erzwungene technische Sharding-Logik.
   - Ordner können entweder als eigene Tabelle `note_folders` oder als `metadata.folder_path` gespeichert werden.
   - Empfehlung: eigene Tabelle plus `notes.metadata.folder_path` oder direkte Spalte, damit wir später sauber sortieren, filtern und umbenennen können.

3. Neue Folder-Navigation im Notes-Bereich
   - Linke Notes-Seitenleiste erhält zusätzlich eine einfache Ordneransicht:

```text
All Notes
Favorites
Trash

Folders
  Inbox
  People
  Projects
    Menerio
    Temerio
  Reference
```

   - Klick auf einen Ordner filtert die Notes-Liste auf diesen Ordner.
   - Suche bleibt ordnerübergreifend möglich.
   - Optional später: Drag & Drop von Notes in Ordner.

4. Titelkonflikt beim Anlegen oder Umbenennen erkennen
   - Beim Speichern eines Titels prüfen wir, ob im gleichen Ordner bereits eine nicht-gelöschte Note mit gleichem Titel existiert.
   - Wenn ja, zeigen wir einen Dialog mit drei Optionen:

```text
A. Merge
   Den aktuellen Text unter die bestehende Note anhängen.
   Danach wird die aktuelle leere/neue Note gelöscht oder geschlossen.

B. Rename
   Nutzer muss einen anderen Titel eingeben.

C. Keep duplicate safely
   Der sichtbare Titel bleibt "X".
   Der GitHub-Dateiname wird kollisionssicher, z. B. "X 1.md".
```

5. Wichtig: Titel und Dateiname trennen
   - Der Titel in Menerio bleibt ein semantischer Titel.
   - Der GitHub-/Obsidian-Dateiname ist ein exportierter Pfad.
   - Beispiel:

```text
Menerio title:
  Meeting

GitHub file path:
  Projects/Menerio/Meeting 1.md

Frontmatter:
  title: "Meeting"
  id: "..."
```

   - Das ist wichtig, weil Option C sonst die Note selbst künstlich umbenennen würde.

6. Merge-Verhalten definieren
   - Bei Merge wird der neue Inhalt an die bestehende Note angehängt, z. B. mit Trenner:

```markdown

---

## Merged on 2026-04-25

{aktueller Text}
```

   - Tags werden vereinigt.
   - Relevante Metadaten werden erhalten, soweit konfliktfrei.
   - Danach wird die neue Note entfernt oder in Trash verschoben, damit keine Doppelung bleibt.
   - Für Sicherheit: erst nach erfolgreichem Update der Zielnote löschen/archivieren.

7. GitHub Sync auf Obsidian-Dateipfade umstellen
   - `github-sync-export` nutzt künftig:

```text
{vault_path}/{folder_path}/{safe_filename}.md
```

   - Wenn die Note bereits einen Sync-Pfad hat, wird dieser respektiert, außer Nutzer ändert bewusst Ordner oder Titel.
   - Bei Kollision im gleichen Ordner wird automatisch ein freier Dateiname gesucht:

```text
Meeting.md
Meeting 1.md
Meeting 2.md
```

   - Dabei wird geprüft, ob der Pfad bereits durch eine andere Menerio-Note oder durch eine externe Obsidian-Datei belegt ist.

8. GitHub Pull/Import anpassen
   - Beim Import aus Obsidian wird der Ordner aus dem Dateipfad übernommen.
   - Beispiel:

```text
GitHub path: Projects/Menerio/Meeting.md
Menerio title: Meeting
folder_path: Projects/Menerio
```

   - Wenn Frontmatter `id` vorhanden ist, matched Menerio über die stabile ID.
   - Wenn keine ID vorhanden ist, matched Menerio über Pfad.
   - Wenn weder ID noch bekannter Pfad existiert, wird eine neue Note importiert.

9. Settings vereinfachen
   - Die bisherige Idee „By type“, „By tag“, „By month“ würde ich nicht als Default nehmen.
   - Stattdessen:

```text
Folder strategy:
  User-controlled folders, Obsidian-compatible
```

   - Optional später als Power-User-Feature:
     - automatisch nach Typ einsortieren
     - automatisch nach Tag einsortieren
     - Datumsordner
   - Aber nicht als Grundverhalten.

10. Bestehende Notes migrieren
   - Alle bestehenden Menerio-Notes bekommen zunächst `folder_path = ""` oder `Inbox`.
   - Bereits synchronisierte Notes behalten ihren vorhandenen `github_sync_log.github_path`, damit wir keine unnötigen Git-Renames erzeugen.
   - Erst wenn der Nutzer eine Note verschiebt oder den Titel aktiv ändert, wird der Pfad entsprechend aktualisiert.

Technische Details

- Schema:
  - Entweder `notes.folder_path text default ''` plus optional `note_folders`.
  - Empfehlung: `notes.folder_path` für einfache, robuste Obsidian-Kompatibilität; `note_folders` nur, wenn wir UI-seitig Ordner-Metadaten wie Sortierung/Farbe brauchen.
- Frontend:
  - `src/pages/Notes.tsx`: Folder-Filter und Folder-Navigation ergänzen.
  - `src/components/notes/NoteEditor.tsx`: Titelkonflikt-Dialog und Move-to-folder UI ergänzen.
  - `src/hooks/useNotes.ts`: Create/Update um `folder_path` erweitern.
  - Neuer Dialog für Merge/Rename/Keep duplicate.
- Edge Functions:
  - `supabase/functions/github-sync-export/index.ts`: Pfadgenerator zentralisieren und kollisionssicher machen.
  - `supabase/functions/github-sync-pull/index.ts`: Pfad zu Folder/Title auflösen und Frontmatter-ID priorisieren.
- Settings:
  - `src/components/settings/GitHubSyncSettings.tsx` und `SyncDashboard.tsx`: Text auf „Obsidian-compatible user folders“ aktualisieren.

Mein finales Votum

Ja: Unique Titles innerhalb eines Ordners sind Obsidian-nah und sinnvoll. Aber wir sollten sie nicht hart global erzwingen.

Die beste UX ist:

```text
Default: Warnen, wenn Titel im selben Ordner existiert.
Optionen: Merge, Rename, Keep duplicate safely.
Sync: Dateipfad immer kollisionssicher.
Ordner: Nutzerkontrolliert, nicht automatisch nach Monat.
```

Damit bekommen wir Obsidian-Kompatibilität, schützen vor versehentlichem Überschreiben und geben Power-Usern eine echte alternative Navigationsstruktur.