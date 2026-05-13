# Person Display-Name editierbar machen

## Problem
Beim Mergen werden Namens-Suffixe wie "(Follow-up)" übernommen. Aktuell kann man im Person-Profil nur Aliases und Notes bearbeiten, **nicht den Namen selbst**.

## Lösung
Den Namen in den bestehenden Edit-Modus auf der Person-Detailseite (`src/pages/People.tsx`, Overview-Tab) integrieren.

### Änderungen in `src/pages/People.tsx`
1. Neuen State `editingName: string | null` hinzufügen.
2. `startEditing(person)` setzt zusätzlich `setEditingName(person.name)`.
3. Cancel/Save resetten/speichern auch den Namen.
4. In der `CardHeader` (Zeile 271–276): Wenn `isEditing`, statt `{selectedPerson.name}` ein `<Input>` rendern (mit Icon davor wie bisher), sonst den Text wie gehabt.
5. `saveChanges` ruft `updatePerson.mutate({ id, name: editingName.trim(), aliases, notes })` — leerer Name wird abgelehnt (Toast).

### Validierung
- Name darf nicht leer sein (trim).
- Keine Schema-Änderungen nötig — `contacts.name` ist bereits ein editierbares Feld und `updatePerson` Mutation existiert bereits.

## Out of scope
- Automatisches Bereinigen von Suffixen während des Merge (separate Diskussion wert, falls gewünscht).
- Namens-Bearbeitung in der Listenansicht (Inline).
