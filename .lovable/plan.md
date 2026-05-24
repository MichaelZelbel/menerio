## Ziele

1. **Persönlicher Header bleibt immer sichtbar.** Aktuell befindet sich Name, Avatar, Aliases und die Action-Buttons (Edit / Merge / Delete / McpVisibility) innerhalb des `Overview`-Tab-Inhalts. Wechselt man zu `Profile`, `Groups`, `Conversation`, `Timeline` oder `Documents`, verschwindet der Name.
2. **Klarheit über „Related Notes"-Bearbeitung.** Die Liste wird automatisch abgeleitet — sie ist keine manuell editierbare Beziehungsliste.

## Änderungen

Datei: `src/pages/People.tsx`

### 1. Header aus Overview herausziehen (sticky)

- Den `Card` mit Avatar/Name/Aliases/Action-Buttons (aktuell Zeilen 286–371) aus `<TabsContent value="overview">` herausnehmen und **oberhalb** der `<Tabs>`-Komponente platzieren, direkt unter dem „Back to People"-Button.
- Auch `DuplicateHints` (372–381) dorthin verschieben, damit Merge-Hinweise immer sichtbar bleiben.
- Den Header-Container `sticky top-0 z-10 bg-background` setzen (mit `pb-2` für Atemraum), damit der Name beim Scrollen langer Tabs (Timeline, Documents) sichtbar bleibt.
- Edit-Mode bleibt unverändert: `isEditing` togglet weiterhin Name-/Alias-Inputs innerhalb desselben Headers — funktioniert auf jedem Tab.
- `Overview`-Tab enthält danach nur noch die Notes-Card (383–401) und die Related-Notes-Card (403–423).

### 2. Related Notes: Bearbeitungshinweis

- Die Related-Notes-Card ist eine reine **Read-only-Ableitung** aus Notes, deren `metadata.people` den Personennamen oder Alias enthält (siehe Query Zeile 112–133). Sie ist bewusst nicht direkt editierbar; die Verbindung wird gesetzt, wenn eine Note die Person erwähnt.
- In der `CardHeader` eine kleine `CardDescription` (oder `<p className="text-xs text-muted-foreground">`) ergänzen:
  „Automatically derived from notes that mention this person. Open a note to add or remove the mention."
- Jeder Listeneintrag bleibt ein `Link` zur Note (bereits vorhanden) — von dort kann der Nutzer die Erwähnung editieren.

## Keine Änderungen

- Tab-Struktur, Datenmodell, Queries, ContactProfileTab, PersonTimeline, etc.
- Kein neues Editier-UI für Related Notes — das Verhalten ist absichtlich abgeleitet.
