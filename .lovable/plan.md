# Note-Toolbar konsolidieren (Obsidian-Stil)

## Ziel

Die separate **Action-Toolbar** über dem Editor (Favorite, Pin, Tag, Info, Connections, Local Graph, Version History, Send-to-App, Classify, Source Mode, AI Chat, Copy, Download, Link, Open-in-Tab, Share, Trash) entfernt die visuelle Konkurrenz mit der **Formatierungstoolbar**, indem sie in ein Drei-Punkte-Menü (`⋯`) am rechten Ende der Formatierungstoolbar wandert — analog zu Obsidian.

Das ist UI-technisch eine **gute** Lösung:
- Reduziert visuellen Lärm um eine ganze Toolbar-Zeile
- Sekundäre/seltene Aktionen gehören in ein Overflow-Menü
- Häufige Aktionen (Favorite, Pin, AI Chat) bleiben als Quick-Access sichtbar
- Etablierte Konvention (Obsidian, Notion, Google Docs)

## Aufteilung: Sichtbar vs. im Menü

**Sichtbar bleiben (rechts in der Formatierungstoolbar, vor `⋯`)** — die 2–3 häufigsten Aktionen:
- ⭐ Favorite (Toggle, mit aktivem State)
- 📌 Pin (Toggle, mit aktivem State)
- 💬 AI Chat (Toggle, mit aktivem State)
- "Shared"-Badge wenn aktiv

**Ins Drei-Punkte-Menü (`⋯`)** — gruppiert mit Separators:

*Gruppe 1 — View & Info*
- Note info
- Add tag
- Source mode (mit Check-Indikator wenn aktiv)

*Gruppe 2 — Connections*
- Find connections
- Local graph (mit Check wenn aktiv)
- Version history (nur wenn `syncLog` existiert)

*Gruppe 3 — AI*
- Classify with AI (nur wenn keine Metadata, nicht trashed)

*Gruppe 4 — Share & Export*
- Copy to clipboard
- Download Markdown
- Copy note link
- Open in new tab
- Share publicly / Stop sharing / Copy public link
- Send to app

*Gruppe 5 — Destructive*
- Move to trash (rot)

**Trashed-State**: Im Menü nur Restore + Delete Forever.

**External-Notes**: Action-Toolbar entfällt komplett (existierende `is_external` Read-Only-Bar bleibt unverändert).

## Technische Umsetzung

### 1. `src/components/notes/EditorToolbar.tsx`
- Neue optionale Props: `noteActions?: React.ReactNode` und `quickActions?: React.ReactNode`.
- `quickActions` wird vor dem bestehenden `flex-1`-Spacer (vor Undo/Redo) eingefügt — oder besser nach Undo/Redo am rechten Rand.
- `noteActions` wird ganz rechts als `⋯`-DropdownMenu gerendert (nutzt vorhandenes `DropdownMenu`/`DropdownMenuItem`/`DropdownMenuSeparator` aus shadcn).
- Wenn beide Props undefiniert sind, ändert sich nichts (Editor-Komponente außerhalb von NoteEditor bleibt unberührt).

### 2. `src/components/notes/NoteEditor.tsx`
- Block "Action toolbar" (Zeilen 760–903) wird gelöscht.
- Stattdessen werden zwei Render-Helfer in der Render-Funktion gebaut:
  - `quickActions`: Favorite + Pin + AI Chat + Shared-Badge als kompakte Icon-Buttons.
  - `noteActions`: `<DropdownMenu>` mit `MoreHorizontal`-Trigger und allen oben gelisteten `DropdownMenuItem`s, gruppiert via `DropdownMenuSeparator`. Jeder Item-Eintrag hat `<Icon />` + Label.
- Beide werden via Props an `<EditorToolbar editor={editor} quickActions={...} noteActions={...} />` übergeben.
- Für External Notes (Read-Only) wird kein Menü übergeben — die existierende Read-Only-Action-Bar bleibt.
- Für trashed Notes: nur Restore + Delete Forever im Menü.

### 3. Info-Panel-Verhalten
Das `showInfo`-Panel (Zeilen 905–923) bleibt bestehen — getoggelt jetzt vom Menüeintrag "Note info" statt vom Toolbar-Icon.

### 4. Keine Funktionalitätsänderungen
Alle Handler (`toggleFavorite`, `togglePin`, `moveToTrash`, `downloadMarkdown`, `processNote.mutate`, `shareNote.mutate`, `unshareNote.mutate`, `copyShareLink.mutate`, `setShowChat`, `setShowConnections`, `onToggleLocalGraph`, `setShowHistory`, `setShowForwardDialog`, `toggleSourceMode`, `setShowTagInput`, `setShowInfo`, Restore, Delete Forever) bleiben unverändert — nur die Trigger-UI wandert.

## Visuelles Ergebnis

```text
Vorher:
┌─────────────────────────────────────────────────────────────┐
│ ⭐ 📌 🏷 ℹ 🔗 🕸 📜 📤 ✨Classify </> 💬 📋 ⬇ 🔗 ↗ 🌐 🗑  │  ← Action toolbar
├─────────────────────────────────────────────────────────────┤
│ ¶ Normal | B I U S … | 🎨 | • 1. ☑ | " — </>  | ↶ ↷       │  ← Format toolbar
└─────────────────────────────────────────────────────────────┘

Nachher:
┌─────────────────────────────────────────────────────────────┐
│ ¶ Normal | B I U S … | 🎨 | • 1. ☑ | " — </>  | ↶ ↷  ⭐📌💬 ⋯│
└─────────────────────────────────────────────────────────────┘
                                                            │
                                          ┌─────────────────┘
                                          │ ℹ  Note info    │
                                          │ 🏷 Add tag       │
                                          │ </> Source mode │
                                          │ ───────────────  │
                                          │ 🔗 Find connections│
                                          │ 🕸 Local graph   │
                                          │ 📜 Version history│
                                          │ ───────────────  │
                                          │ ✨ Classify      │
                                          │ ───────────────  │
                                          │ 📋 Copy          │
                                          │ ⬇  Download      │
                                          │ 🔗 Copy link     │
                                          │ ↗  Open new tab  │
                                          │ 🌐 Share publicly│
                                          │ 📤 Send to app   │
                                          │ ───────────────  │
                                          │ 🗑 Move to trash │
                                          └─────────────────┘
```

## Geänderte Dateien

- `src/components/notes/EditorToolbar.tsx` — zwei optionale Props + Render-Slots
- `src/components/notes/NoteEditor.tsx` — alte Action-Toolbar entfernen, Quick-Actions + Dropdown bauen und an Editor-Toolbar übergeben

## Aufwand

Klein bis mittel. Eine einzelne Änderungs-Session, keine Migrations, keine Hook-Änderungen, kein Risiko für bestehende Tests.
