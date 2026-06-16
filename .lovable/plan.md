## Ziel

Menerio auf Mobilgeräten benutzbar machen, beginnend mit dem Notes-Workspace (akutestes Problem), und das Wissen als wiederverwendbaren Skill für weitere Seiten festhalten.

## Teil A — Notes-Workspace mobil nutzbar machen (Sofortmaßnahme)

Das aktuelle Layout in `src/pages/Notes.tsx` ist ein starres 3-Spalten-Flex (`w-72` Tree | Notizliste | Editor). Auf < 768 px läuft der Editor aus dem Viewport. Lösung: **Single-Pane-Stack auf Mobil** mit drei sichtbaren Zuständen (Tree, Liste, Editor) und Navigation per Zurück-Button / Drawer — wie Obsidian Mobile, Bear, Apple Notes.

### Verhalten

```text
Desktop (≥ md):                Mobil (< md):
┌─────┬──────┬──────────┐      ┌──────────────┐
│Tree │Liste │ Editor   │      │ aktives Pane │
└─────┴──────┴──────────┘      └──────────────┘
                                 + Header mit ←
                                 + Drawer für Tree
```

Mobiler Pane-State: `'tree' | 'list' | 'editor'`.
- App-Start auf Mobil: `'list'` (Vault-Wurzel).
- Tap auf Ordner/Tag im Tree → `'list'`.
- Tap auf Notiz in Liste → `'editor'`.
- Editor-Header bekommt mobilen `← Zurück`-Button → `'list'`.
- Listen-Header bekommt mobilen Menü-Button → öffnet Tree als **Sheet** (Drawer von links).

### Konkrete Änderungen

1. **`src/pages/Notes.tsx`**
   - `useIsMobile()` einbinden.
   - Wrapper `min-h-[100dvh]` statt `100vh` (iOS-Adressleiste).
   - Mobil: Tree-Spalte aus dem Flex entfernen und stattdessen in ein `Sheet` (shadcn) verschieben, ausgelöst durch einen Menü-Button im Listen-Header.
   - Mobil: nur das aktive Pane rendern (`mobilePane`-State). Desktop unverändert.
   - Editor-Pane auf Mobil bekommt Header-Zeile mit `← Notizen`-Button.
   - Notiz-Auswahl-Handler setzt zusätzlich `mobilePane='editor'`.
   - Alle Container im Editor-Pfad: `min-w-0` ergänzen, damit lange Inhalte umbrechen statt zu sprengen.

2. **`src/components/notes/NoteTree.tsx`** (nur sanft)
   - Touch-Targets: Zeilen-Padding `py-1` → `py-1.5` auf Mobil (≥ 36 px Höhe, ausreichend für Listen mit Disclosure-Icons).
   - Sicherstellen, dass Klick auf einen Ordner im Sheet das Sheet schließt.

3. **Globale Shell** (`DashboardLayout.tsx`)
   - Höhenberechnungen `calc(100vh - 56px)` → `calc(100dvh - 56px)` an den 2–3 betroffenen Stellen.

4. **`src/index.css`**
   - `env(safe-area-inset-bottom)` als Padding für fixed Footer / Editor-Toolbar.

Keine Änderung an Editor-Logik, Suche, Daten, Routing-Struktur.

### Verifikation

- Preview auf 375 × 812 (iPhone) und 768 × 1024 (iPad): Tree-Sheet öffnen, Notiz wählen, Editor sichtbar, Zurück führt zurück.
- Desktop ≥ 1024 px: unverändert.
- `bunx tsc --noEmit` clean.

## Teil B — Skill „responsive-design" anlegen

Datei: `.agents/skills/responsive-design/SKILL.md`, danach `skills--apply_draft`.

Inhalt (Kurzform):
- **Mobile-first**: Layout für < 768 px zuerst denken, dann `md:` aufwärts ergänzen.
- **Ein-Pane-Regel**: Multi-Pane-Workspaces auf Mobil zu Stack + Drawer/Sheet umbauen, nie horizontal quetschen.
- **Höhe**: `100dvh` statt `100vh`; Header-Offsets über `calc(100dvh - Xpx)`.
- **Overflow**: jeder Flex-Child, der Text enthält, braucht `min-w-0`; nur explizit gewollte Bereiche dürfen horizontal scrollen.
- **Touch**: Buttons/Links ≥ 40 px Höhe auf Mobil; Hover-Only-UI durch sichtbare Aktionen ersetzen.
- **Safe areas**: `env(safe-area-inset-*)` für fixe Leisten.
- **Tooling**: `useIsMobile()` für Verzweigungen, `Sheet` für Drawer, `Tabs`/State für Pane-Switching.
- **QA-Checkliste**: 375 × 812, 768 × 1024, 1280 × 800.

Damit wird der Skill bei jeder weiteren Mobile-Aufgabe automatisch verfügbar.

## Out of scope (Folgearbeit)

- Mobile-Optimierung weiterer Seiten (People, Lexicon, Graph, Settings, Admin). Jede bekommt einen eigenen, ähnlich kleinen Pass — der Skill aus Teil B leitet die Arbeit.
- PWA-/Capacitor-Optimierungen.
- Gesten (Swipe-zum-Zurück) — erst nach Validierung des Tap-Flows.
