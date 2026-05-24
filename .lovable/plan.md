## Problem
Das Datumsfeld in Collections (z. B. „Movies and TV") nutzt aktuell den shadcn `Calendar` (react-day-picker) im Popover. Navigation geht nur monatsweise vor/zurück — Sprünge über Jahre sind mühsam, und freie Eingabe gibt es nicht.

## Ziel
Ein einziger, wiederverwendbarer Datepicker, der drei Wege zur Datumswahl kombiniert:
1. Komfort-Kalender wie heute (Maus-Klick).
2. Schnelles Springen über Monate und Jahre.
3. Freie Texteingabe eines Datums.

Gilt für `date` **und** `datetime` Felder in Collections.

## UX
Im Popover (über dem bestehenden Kalender):

```text
┌───────────────────────────────────────┐
│ [ 2005-03-14         ]  (Texteingabe) │
│ Month: [March ▾]   Year: [2005 ▾]     │
├───────────────────────────────────────┤
│           [ Kalender wie heute ]      │
└───────────────────────────────────────┘
```

- **Texteingabe** oben im Popover: Input mit Placeholder `YYYY-MM-DD`. Akzeptiert auch `DD.MM.YYYY` und `MM/DD/YYYY`. Bei gültigem Parse → Kalender springt mit, Wert wird gesetzt. Bei ungültigem Input → dezenter roter Rand, kein Toast.
- **Monat-Dropdown**: Select mit 12 Monatsnamen (lokalisiert via `date-fns`).
- **Jahr-Dropdown**: Select mit Jahresbereich `currentYear − 100` bis `currentYear + 10` (also ~110 Einträge), default scrollt zum aktuell gewählten Jahr. Schnelles Springen zu „1985" möglich.
- **Kalender** darunter bleibt unverändert (Maus-Klick wählt finalen Tag).
- Auswahl eines Tages im Kalender schließt das Popover (wie heute).
- Bei `datetime` bleibt der separate Time-Input rechts daneben unverändert.

Tastatur:
- Im Textfeld: `Enter` übernimmt den geparsten Wert und schließt das Popover.
- `Tab` wandert Textfeld → Monat → Jahr → Kalender.

## Technisch

### Neue Komponente
`src/components/ui/smart-date-picker.tsx`

Props:
```ts
type SmartDatePickerProps = {
  value: Date | null;
  onChange: (date: Date | null) => void;
  placeholder?: string;
  className?: string;
  ariaLabel?: string;
};
```

Intern:
- Lokaler `viewMonth: Date`-State für das Kalender-Display (entkoppelt vom Wert, damit Monat/Jahr-Dropdowns auch ohne Auswahl springen können).
- Genutzt wird `<Calendar … month={viewMonth} onMonthChange={setViewMonth} />` (react-day-picker unterstützt das bereits, kein neues Dep).
- Parser-Helper `parseLooseDate(input: string): Date | null` mit Versuchen in Reihenfolge: `yyyy-MM-dd`, `dd.MM.yyyy`, `MM/dd/yyyy`, `yyyy/MM/dd` (via `date-fns/parse`).
- Bei `onChange` aus dem Textfeld → debounced (150 ms) `setViewMonth(parsed)` und `onChange(parsed)`.
- Monat-/Jahr-Selects nutzen `@/components/ui/select`; bei Änderung: neuen `viewMonth` setzen, Tag bleibt (clamp auf letzten gültigen Tag des Monats, z. B. 31. → Feb wird 28./29.).

### Integration
`src/pages/CollectionDetail.tsx` (Zeilen 961–989 für `date`, 990–1040 für `datetime`):
- `date`-Zweig: `Popover/PopoverTrigger/PopoverContent/Calendar` ersetzen durch `<SmartDatePicker value={selectedDate} onChange={d => onChange(d ? format(d, "yyyy-MM-dd") : "")} />`. Der Trigger (Button mit `CalendarIcon` + formatiertes Datum) wandert in die neue Komponente.
- `datetime`-Zweig: gleiche Ersetzung für den Date-Teil, Time-Input bleibt.

Keine weiteren Aufrufer ändern in diesem Schritt — wenn der User später möchte, können wir TimelinePage-Datepicker, AddEventDialog etc. auf dieselbe Komponente migrieren.

### Bestehende Deps
- `date-fns` (schon da) — `parse`, `format`, `setMonth`, `setYear`, `lastDayOfMonth`.
- `react-day-picker` (über shadcn `Calendar`) — `month`/`onMonthChange` Props.
- Keine neuen Pakete.

### Edge Cases
- Leerer Text → `onChange(null)`.
- Jahr außerhalb 1900–2100 im Text → trotzdem zulassen (manche Filme sind älter), Dropdown zeigt dann den nächstgelegenen Wert.
- `viewMonth` initial = `value ?? new Date()`.

## Geänderte / neue Dateien
- **Neu:** `src/components/ui/smart-date-picker.tsx`
- **Geändert:** `src/pages/CollectionDetail.tsx` (date- und datetime-Branches)

## Out of scope
- Migration anderer Datepicker (Timeline, AddEventDialog) — separat, falls gewünscht.
- Recurring-Date-Patterns o. Ä.
