## Ziel

Einheitlicher, kleiner MyCö-Sichtbarkeits-Button für alle Datentypen (People, Notes, Moments, Collection-Items, Action-Items). Klares mentales Modell: **Auge = sichtbar via MyCö**, **durchgestrichenes Auge = versteckt**. Kein Schild mehr — Schild suggeriert fälschlich „geschützt vs. ungeschützt".

## Neue Komponente: `<McpVisibilityButton />`

Ein einziger, wiederverwendbarer Pill-Button, identisch in Aussehen und Verhalten überall:

- **Aus-Zustand (default, sichtbar)**: `Eye`-Icon + Label „MyCö" — dezent (`variant="outline"`, muted Foreground).
- **An-Zustand (versteckt)**: `EyeOff`-Icon + Label „Hidden" — etwas akzentuiert (`variant="secondary"` oder amber tint), damit klar ist „Status aktiv geändert".
- Tooltip:
  - sichtbar → „Visible via MyCö (MCP / ChatGPT, Claude …). Click to hide."
  - versteckt → „Hidden from MyCö. Click to make visible again."
- Größe: `size="sm"`, kompakt — passt in Header-Leisten und Listen-Rows.
- Loading-State während Mutation.

Props:
```ts
type EntityKind = "person" | "note" | "moment" | "collection_item" | "action_item";
{ kind: EntityKind; id: string; hidden: boolean; className?: string }
```

Intern entscheidet die Komponente:
- Bei `kind="person"` ruft sie `useToggleSensitivePerson` auf (toggelt `is_sensitive`, wirkt zusätzlich auf verknüpfte Items).
- Bei allen anderen ruft sie `useToggleMcpVisibility(kind)` auf (toggelt `mcp_visibility`).

So bleibt für den Nutzer das Label **immer** „MyCö / Hidden" mit Auge — die unterschiedliche Backend-Semantik (Person = sensitiv inkl. Vererbung, Item = nur dieses Objekt) bleibt unsichtbar im Tooltip-Detail erklärt:
- Person-Tooltip ergänzt: „Also hides all notes and moments linked to this person."

## Einbauorte

1. **People** (`src/pages/People.tsx`) — ersetzt aktuellen Shield-Button + „Sensitive"-Badge im Header der Detail-Ansicht.
2. **NoteEditor** (`src/components/notes/NoteEditor.tsx`) — ersetzt „MCP hidden"-Badge + Dropdown-Item „Hide from MCP / AI clients". Button wandert in die Header-Toolbar neben die anderen Actions.
3. **AddEventDialog / Moment-Detail-Drawer** (`src/components/timeline/AddEventDialog.tsx`, `src/pages/TimelinePage.tsx` Sheet) — Button im Drawer-Header.
4. **CollectionDetail** (`src/pages/CollectionDetail.tsx`) — Button in der Item-Detail-Ansicht (Header oder Inline-Row je nach Layout).
5. **Actions** (`src/pages/Actions.tsx`) — Button am Action-Item-Row (klein, rechts).

Alle bisherigen Shield-Icons/„Mark sensitive"/„MCP hidden"-Badges werden entfernt — eine einzige visuelle Sprache überall.

## Aufräumen

- Shield/ShieldOff-Imports in `People.tsx` raus.
- Separates „MCP hidden"-Badge in NoteEditor raus (Button kommuniziert den Zustand bereits).
- Dropdown-Item „Hide from MCP" im NoteEditor-Menü raus (redundant zum Button).

## Was unverändert bleibt

- Backend-Filter, RPCs, Hooks (`useToggleMcpVisibility`, `useToggleSensitivePerson`) — nur die UI-Hülle ändert sich.
- DB-Schema, MCP-Server-Logik.

## Geänderte/neue Dateien

- `src/components/common/McpVisibilityButton.tsx` (neu)
- `src/pages/People.tsx` (Shield-Button ersetzen)
- `src/components/notes/NoteEditor.tsx` (Badge + Dropdown raus, Button rein)
- `src/components/timeline/AddEventDialog.tsx` und/oder `src/pages/TimelinePage.tsx` (Button im Drawer)
- `src/pages/CollectionDetail.tsx` (Button einbauen)
- `src/pages/Actions.tsx` (Button pro Row)

## Verifikation

- Button sieht in allen fünf Kontexten identisch aus.
- Sichtbarer Zustand = Auge + „MyCö"; versteckter Zustand = durchgestrichenes Auge + „Hidden".
- Klick toggelt sofort, Tooltip erklärt Konsequenz.
- Bei Person zusätzlich Hinweis im Tooltip, dass auch verknüpfte Items betroffen sind.
- Keine Shield-Icons mehr im Codebase im Kontext MCP/Sensitive.