## Problem

Im "Add Moment"-Dialog (`src/components/timeline/AddEventDialog.tsx`) wird das `People`-Feld als flache Liste von Checkboxes gerendert. Bei vielen Kontakten (>20) wird der Dialog dadurch lang, unübersichtlich, und ausgewählte Personen sind in der Masse kaum erkennbar.

## Lösung: Searchable Multi-Select mit ausgewählten Chips oben

Bewährtes Muster (Linear/Notion-Style), das beide Anforderungen erfüllt:
1. **Sofort sichtbar, wer ausgewählt ist** → ausgewählte Personen erscheinen als entfernbare Chips direkt unter dem Label.
2. **Schnell jemanden finden / durchscrollen** → ein Combobox-Trigger öffnet ein Popover mit Suchfeld + virtualisierungsfreundlicher, kompakter Ergebnisliste. Tippen filtert sofort, Enter/Klick toggelt Auswahl, ausgewählte Einträge zeigen ein Häkchen und bleiben oben in der Liste.

### UI-Aufbau (im Dialog, ersetzt Zeile 247)

```text
People
[ @Alice ×] [ @Bob ×] [ @Carla ×]   ← Chips der bereits Ausgewählten
[ + Add person ▾ ]                  ← Combobox-Trigger

  ┌─ Popover ─────────────────────┐
  │ 🔍 Search people…             │
  │ ─────────────────────────────│
  │ ✓ Alice                      │  ← Selected (sortiert nach oben)
  │ ✓ Bob                        │
  │   Andrew Huberman            │
  │   Andrew Ng                  │
  │   …                          │
  └──────────────────────────────┘
```

- Chip-Klick auf `×` entfernt die Person sofort.
- Popover bleibt nach Auswahl offen → mehrere Personen schnell hinzufügbar (Linear-Pattern).
- Wenn keine Person ausgewählt: Trigger zeigt `+ Add person`. Ansonsten zeigt er `+ Add more` und die Chip-Reihe steht darüber.
- Suche matched case-insensitive auf `name` (substring).
- Keine vertikale Inflation mehr: das Feld ist konstant ~1–2 Zeilen hoch, egal wie viele Kontakte existieren.

### Suggested-new-people (KI-Vorschläge, Zeile 248)

Bleibt als separater Block direkt darunter — diese Liste ist normalerweise klein (1–5 Namen aus dem aktuellen Draft) und profitiert von expliziten Checkboxes. Unverändert.

## Technische Umsetzung

Eine Datei betroffen: `src/components/timeline/AddEventDialog.tsx`.

1. Neue lokale Komponente `PeopleMultiSelect` im selben File (oder ausgelagert nach `src/components/timeline/PeopleMultiSelect.tsx`, falls die Datei sonst zu groß wird):
   - Props: `people: TimelineContact[]`, `value: string[]`, `onChange: (ids: string[]) => void`.
   - Aufgebaut aus shadcn `Popover` + `Command` (`CommandInput`, `CommandList`, `CommandEmpty`, `CommandGroup`, `CommandItem`) — beides bereits im Projekt vorhanden (`src/components/ui/popover.tsx`, `src/components/ui/command.tsx`).
   - Items sortiert: zuerst ausgewählte (mit `Check`-Icon), dann der Rest alphabetisch.
   - `onSelect` toggelt die ID in `value`; Popover schließt sich nicht (`onSelect` setzt nicht `setOpen(false)`).
   - Chips oberhalb des Triggers: shadcn `Badge variant="secondary"` mit `X`-Icon-Button (Pattern wie in `NoteMetadataEditor.tsx` Zeilen 192–215).

2. In `AddEventDialog`:
   - Zeile 247: ersetze `<div className="flex flex-wrap gap-x-4 …">{people.map(...)}` durch `<PeopleMultiSelect people={people} value={matchedPeople} onChange={setMatchedPeople} />`.
   - `matchedPeople` State und Logik bleiben unverändert.

3. Keine Änderungen an Daten, RPCs, Save-Logik oder am Suggested-new-people-Block.

## Out of Scope

- Keine Änderungen am `draft-event` Edge Function.
- Keine Änderung des Suggested-new-people-Layouts.
- Keine Pagination/Virtualisierung — `cmdk` (das `Command` intern nutzt) handhabt mehrere hundert Items performant via Suche/Filter.
