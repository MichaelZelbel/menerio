## Ziel

In `CollectionDetail` (Tabellenansicht einer Collection) sollen Nutzer:innen Items **nach jeder Spalte sortieren** und **nach jeder Spalte filtern** können — zusätzlich zu der bestehenden Suchleiste und dem globalen Sort-Dropdown.

## UX

### Sortieren per Spaltenkopf
- Jeder Spaltenkopf (`TableHead`) wird zu einem Button mit kleinem Pfeil-Icon.
- Klick zyklisch: **aus → aufsteigend → absteigend → aus**.
- Es ist immer nur **eine** Spalte aktiv sortiert. Aktivierung einer Spalten-Sortierung setzt das bestehende globale Sort-Dropdown auf "Custom" und überschreibt es.
- Title- und Updated-Spalte sind ebenfalls sortierbar.
- Typ-gerechte Vergleichsfunktion: Zahlen/Currency numerisch, Date/Datetime chronologisch, Boolean true>false, Select/Text/URL/Email/Phone lokalisierter String-Vergleich, Multiselect nach erstem Wert, Link-Felder nach `label`. Leere Werte landen immer am Ende.

### Filtern per Spalte
- Neuer Button "Filters" neben "Columns" öffnet ein Popover. Pro Feld eine Zeile mit passender Eingabe:
  - **text / longtext / url / email / phone**: Textfeld, "enthält" (case-insensitive).
  - **number / currency**: zwei kleine Eingabefelder "min" / "max".
  - **date / datetime**: zwei `SmartDatePicker` "von" / "bis".
  - **boolean**: Tri-State Select (Alle / Ja / Nein).
  - **select**: Multi-Checkbox über `field.options`.
  - **multiselect**: Multi-Checkbox; Treffer wenn **eines** der gewählten Optionen im Item enthalten ist.
  - **link_***: Textfeld, vergleicht gegen `label`.
- Titelspalte und Updated bekommen ebenfalls Filter (Text / Datumsbereich).
- Aktive Filter werden als Zahl-Badge am "Filters"-Button angezeigt, plus "Clear all"-Link im Popover.

### Sichtbarkeit
- Filter-Popover ist immer verfügbar (auch bei <5 Feldern). Columns-Popover bleibt wie bisher.

## Auswirkungen auf Laden / Paginierung

Aktuell paginiert die Tabelle serverseitig per `updated_at`-Cursor und Default-Sort. Custom-Sort und beliebige Filter sind serverseitig auf `collection_items.data` (JSONB) nicht effizient — und die Logik wäre groß.

Pragmatischer Kompromiss:

- Sobald **eine Spalten-Sortierung ODER mindestens ein Spaltenfilter aktiv ist**, lädt die Liste in einem Rutsch bis zu **500 Items** (ohne Cursor, mit `.order("updated_at", desc)` als stabilem Server-Basisorder) und macht Sort/Filter **clientseitig**. Der "Load more"-Button und Cursor-Stack werden in diesem Modus ausgeblendet.
- Wenn weder Custom-Sort noch Filter aktiv sind, bleibt das bestehende Verhalten (50er Seiten + Cursor) unverändert.
- Über der Tabelle: kleiner Hinweis "Showing first 500 items matching filters" wenn das Limit erreicht ist.

## Persistenz

Sort- und Filter-Zustand wird **pro Collection-Slug** in `localStorage` gespeichert (`collection:<slug>:view`), sodass der Zustand beim Zurückkehren erhalten bleibt. Bestehende `visibleKeys`-Logik bleibt wie sie ist (optional kann sie später dort mit reinwandern).

## Technische Details

Geänderte Datei: `src/pages/CollectionDetail.tsx`.

Neue Typen und State im `CollectionItemsPanel`-Bereich (um Zeile 1846):

```ts
type ColumnSort = { key: string; dir: "asc" | "desc" } | null;
type ColumnFilter =
  | { type: "text"; value: string }
  | { type: "number"; min: number | null; max: number | null }
  | { type: "date"; from: string | null; to: string | null }
  | { type: "boolean"; value: true | false | null }
  | { type: "set"; values: string[] };
type ColumnFilters = Record<string, ColumnFilter>;
```

Helper:
- `compareByField(field, a, b, dir)` — typgerechter Vergleich, leere Werte ans Ende.
- `matchesFilter(field, value, filter)` — pro Filtertyp.
- `getCellValue(field, item)` — extrahiert Rohwert für Sort/Filter aus `item.data` (bzw. `item.title` / `item.updated_at` für die System-Spalten).

Daten-Loader (`load`-Effekt um Zeile 1874): branch je nach `columnSort || hasActiveFilters`:
- aktiv: Query ohne Cursor, `.limit(500)`, anschließend client-side `filter().sort()`.
- inaktiv: bestehendes Verhalten.

UI:
- `TableHead`-Inhalt wird durch eine `<SortableHeader field={...} sort={columnSort} onToggle={...} />`-Komponente ersetzt (kleines `ArrowUp`/`ArrowDown`/`ArrowUpDown` aus `lucide-react`).
- Neuer "Filters"-Popover mit `Funnel`/`Filter`-Icon, Zähler-Badge, Inhalt rendert pro `nonPrimaryField` + Title + Updated ein passendes Filter-Control.
- "Sort"-Select bekommt einen zusätzlichen aktiven Eintrag "Custom" (statt `disabled`) der erscheint sobald `columnSort !== null`, und beim Zurückwechseln auf `updated/created/alpha` wird `columnSort` zurückgesetzt.

Persistenz via kleinem `useEffect` der `{ columnSort, columnFilters, sort, visibleKeys }` in `localStorage` schreibt und beim Mount liest.

## Nicht im Scope

- Serverseitige Sort/Filter auf JSONB (würde Postgres-Index- und RPC-Arbeit erfordern — separates Thema, falls Collections später deutlich >500 Items haben).
- Mehrspalten-Sort.
- Speichern als "Saved View" pro Collection (kann später kommen, Persistenz-Hook ist bereits vorbereitet).
