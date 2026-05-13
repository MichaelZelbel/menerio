# UX Backlog

Lebendiges Backlog der UX-Verbesserungen. Reihenfolge = grobe Priorität.
Status-Legende: 🟥 Todo · 🟧 In Progress · 🟩 Done · ⬜ Idee/Optional

Pro Eintrag: **Effort** (S/M/L), **Impact** (★1–3), **Bereich**, **Akzeptanzkriterien**.

---

## P0 — Quick Wins (jetzt)

### 1. 🟩 Folder-Delete Confirm via AlertDialog · S · ★★★
- **Bereich:** Notes / NoteTree
- **Akzeptanz:** `window.confirm` ersetzt durch `AlertDialog`. Zeigt Anzahl betroffener Notizen + Subfolder. Destructive-Variante.
- **Files:** `src/components/notes/NoteTree.tsx`, `src/pages/Notes.tsx`

### 2. 🟩 Drag & Drop Source-Feedback · S · ★★
- **Bereich:** Notes / NoteTree
- **Akzeptanz:** Gezogene Folder/Note bekommen `opacity-50`, Cursor `grabbing`. Drop-Target hebt sich mit Border ab.
- **Files:** `src/components/notes/NoteTree.tsx`

### 3. 🟩 Trash: Restore / Delete Permanently · S · ★★★
- **Bereich:** Notes / Trash
- **Akzeptanz:** Im Trash-Filter haben Notizen ein Context-Menu mit "Restore" und "Delete permanently" (mit AlertDialog).
- **Files:** `src/components/notes/NoteTree.tsx`, `src/pages/Notes.tsx`

### 4. 🟩 "Saved · Xs ago" Indicator im Editor · S · ★★
- **Bereich:** Editor
- **Akzeptanz:** Header zeigt Spinner während Save, danach relativen Zeitstempel ("Saved · 2s ago"). Bei Fehler: rote Pille.
- **Files:** `src/components/notes/NoteEditor.tsx`

---

## P1 — High Impact (nächste Welle)

### 5. 🟩 Command Palette (⌘K) · M · ★★★
- **Bereich:** Globale Navigation
- **Akzeptanz:** ⌘K öffnet `CommandDialog`. Aktionen: Go to note (Fuzzy), Create note/contact/group, Open settings, Toggle theme. Unterscheidet sich von ⌘⇧K (AI-Chat).
- **Files:** `src/components/layout/CommandPalette.tsx` (neu), `DashboardLayout.tsx`

### 6. 🟩 WikilinkAutocomplete Tastatur-Navigation · S · ★★★
- **Bereich:** Editor
- **Akzeptanz:** ↑/↓ wählt, Enter/Tab bestätigt, Esc schließt, Home/End springt. Hover und Tastaturauswahl synchronisiert. Aktives Item scrollt in den Sichtbereich.
- **Files:** `src/components/notes/WikilinkAutocomplete.tsx`

### 7. 🟩 Synced-Note Header-Hinweis · S · ★★
- **Bereich:** Editor (External Notes)
- **Akzeptanz:** Banner "Synced from {source} — duplicate to edit" mit primärem Duplicate-Button und Erklärungstext.
- **Files:** `src/components/notes/NoteEditor.tsx`

### 8. 🟩 Integration Overview in Settings · M · ★★
- **Bereich:** Settings
- **Akzeptanz:** Übersichtsseite "Connected: X · Available: Y" oben in Integrations-Tab. Ein-Klick zur Detail-Section.
- **Files:** `src/components/settings/IntegrationsOverview.tsx` (neu), `src/pages/Settings.tsx`

### 9. 🟩 Sort/Filter Toggle in NoteList sichtbar · S · ★★
- **Bereich:** Notes
- **Akzeptanz:** Dropdown im NoteList-Header (Updated/Created/Title/Manual). Persist in localStorage.
- **Files:** `src/components/notes/NoteList.tsx`

---

## P2 — Polish & Discovery

### 10. 🟩 Bulk-Actions in NoteList · M · ★★
- **Bereich:** Notes
- **Akzeptanz:** Shift+Click Multi-Select, Action-Bar unten (Move, Trash, Add to Folder, Tag).
- **Files:** `NoteList.tsx`, `Notes.tsx`

### 11. 🟩 Empty-States mit Capture-Beispielen · S · ★★
- **Bereich:** Notes / Dashboard
- **Akzeptanz:** Statt "No notes yet" → CTA-Karten (Telegram, Web Clipper, MCP, Quick Capture).
- **Files:** `NoteList.tsx`, `Dashboard.tsx`

### 12. 🟩 Folder erstellen aus Sidebar-Header · S · ★
- **Bereich:** Notes / NoteTree
- **Akzeptanz:** `+`-Button neben "All Notes" mit Dropdown (New Note / New Folder).
- **Files:** `NoteTree.tsx`

### 13. 🟩 Duplicate-Hint Banner auf Person-Profil · S · ★★
- **Bereich:** People
- **Akzeptanz:** Pro Duplikat eigener Inline-Banner mit Merge / Dismiss. Dismiss persistiert pro Paar in localStorage. Merge öffnet MergePersonDialog mit vorausgewähltem Ziel.
- **Files:** `src/components/people/DuplicateHints.tsx`, `People.tsx`, `MergePersonDialog.tsx`

### 14. 🟥 ProfileSuggestions Re-Trigger an neue Notizen koppeln · M · ★★
- **Bereich:** Profile
- **Akzeptanz:** Statt 24h-Cooldown: Button aktiv sobald N neue Notizen seit letztem Run.
- **Files:** `ProfileSuggestions.tsx`, ggf. RPC

---

## P3 — A11y & Mobile

### 15. 🟥 Tastatur-Shortcuts in Context-Menüs · S · ★
- **Akzeptanz:** Rename = R, Move = M, Delete = ⌘⌫. ShortcutHints im Menü.

### 16. 🟥 Toast-Konsolidierung · S · ★
- **Akzeptanz:** Bei >2 Toasts gleicher Art → "3 notes moved" statt 3 Toasts.

### 17. 🟥 NoteTree Mobile-Padding · S · ★★
- **Akzeptanz:** Auf <640px depth × 8px statt 14px. Horizontal scroll vermeiden.

### 18. ⬜ Low-Balance Banner persistent · S · ★
- **Akzeptanz:** Bei <10% Credits dauerhafter Banner im Header (nicht nur Toast). Link zu Billing.

---

## Workflow

1. Pick top 🟥 → setze 🟧 → öffne PR-artigen Commit-Scope.
2. Akzeptanzkriterien als Checkliste abarbeiten.
3. Auf 🟩 setzen, Datum + kurze Notiz dahinter.
4. Neu entdeckte Verbesserungen unten als ⬜ ergänzen.
