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

### 14. 🟩 ProfileSuggestions Re-Trigger an neue Notizen koppeln · M · ★★
- **Bereich:** Profile
- **Akzeptanz:** Statt 24h-Cooldown: Button aktiv sobald 5 neue Notizen seit letztem Run. Zeigt Countdown ("3 more notes until next analysis") und neue-Notes-Zahl im aktiven Button.
- **Files:** `ProfileSuggestions.tsx`

---

## P3 — A11y & Mobile

### 15. ↩️ Tastatur-Shortcuts in Context-Menüs · S · ★ — REVERTED
- **Status:** Zurückgerollt. Radix-ContextMenu-Typeahead fängt einzelne Buchstaben ab (z. B. „M" highlightet nur „Move to" statt zu verschieben), eigene `onKeyDown`-Handler griffen daher inkonsistent. Hints waren irreführend → entfernt. Falls neu angegangen: globale Shortcuts auf der ausgewählten Notiz/Folder im Tree statt im offenen Menü.
- **Files:** `src/components/notes/NoteTree.tsx`

### 16. 🟩 Toast-Konsolidierung · S · ★
- **Akzeptanz:** Bei >2 Toasts gleicher Art → "3 notes moved" statt 3 Toasts. `showToast.batched.{success,error,info,warning}(key, formatter)` aggregiert pro Key innerhalb 800ms-Fenster und aktualisiert denselben Sonner-Toast in place. Eingesetzt für Move-Note, Restore-Note, Permanent-Delete-Note.

### 17. 🟩 NoteTree Mobile-Padding · S · ★★
- **Akzeptanz:** Auf <640px depth × 8px statt 14px (auch Note-Basis-Padding 8px statt 14px). `useIsMobile`-Hook gated den Step. Horizontal scroll vermieden.
- **Files:** `src/components/notes/NoteTree.tsx`

### 18. 🟩 Low-Balance Banner persistent · S · ★
- **Akzeptanz:** Bei <10% Credits dauerhafter Banner im Dashboard-Header (amber, dismissbar pro Period). Bei 0 Credits roter Banner ohne Dismiss. Link zu `/dashboard/settings?tab=billing`.
- **Files:** `src/components/layout/LowBalanceBanner.tsx`, `src/components/layout/DashboardLayout.tsx`

---

## P1 — Correctness follow-ups (surfaced 2026-08-26 review, deferred)

These are real but were left out of the 2026-08-26 fix pass because each needs
a data check or a schema change, not just a UI edit.

### 19. 🟥 PersonDetail "related notes" is wrong past 50 notes · M · ★★★
- **Bereich:** People / PersonDetail
- **Problem:** `PersonDetail.tsx:74-93` fetches the 50 most recent notes globally
  and then filters client-side by `metadata.people`. Any user with >50 notes
  sees wrong (usually empty) related notes with no signal. Same shape as the
  collection-sort bug that was fixed.
- **Akzeptanz:** Query filters by person server-side (metadata contains person id)
  before the limit, or paginates; result reflects all of the person's notes.

### 20. 🟥 Collection tree fetch is unbounded and unordered · S · ★★
- **Bereich:** Collections / CollectionItemsTree
- **Problem:** `CollectionDetail.tsx` tree item fetch has no `.limit()` and no
  `.order()`, so it inherits PostgREST's max-rows cap in nondeterministic order.
  Large collections silently lose tree entries.
- **Akzeptanz:** Explicit order; chunked fetch or an honest cap like the table view.

### 21. 🟥 moment_participants has no FK to contacts · M · ★★★
- **Bereich:** Timeline / data integrity
- **Problem:** `moment_participants.person_id` has no `REFERENCES contacts`, so
  deleting a person leaves dangling participant rows that never resolve to a name.
- **Akzeptanz:** Add FK with `ON DELETE CASCADE` after cleaning existing orphans.
  Needs a data check first (count orphans), then a migration.

### 22. 🟥 Archive group has no confirmation · S · ★
- **Bereich:** People / groups
- **Problem:** `People.tsx handleArchiveGroup` archives with no confirm and no
  visible undo affordance.
- **Akzeptanz:** AlertDialog (or a toast with Undo).

### 23. 🟥 Normalise remaining window.confirm to AlertDialog · S · ★
- **Bereich:** Collections, Wiki, Notes
- **Problem:** Several genuinely destructive actions still use native
  `window.confirm` (e.g. `CollectionDetail` tree/note deletes, `WikiLintPlaceholder`
  strip-wikilinks, `StagesEditor`) while the app's own AlertDialog convention exists.
- **Akzeptanz:** Consistent destructive AlertDialog, matching the people/collection pattern.

### 24. 🟥 ModerationPanel caps at 50 with no pagination · S · ★
- **Bereich:** Admin / ModerationPanel
- **Problem:** `moderation_review_queue` fetch capped at 50, no pager.
- **Akzeptanz:** Pagination or an explicit "showing first 50" note.

---

## Workflow

1. Pick top 🟥 → setze 🟧 → öffne PR-artigen Commit-Scope.
2. Akzeptanzkriterien als Checkliste abarbeiten.
3. Auf 🟩 setzen, Datum + kurze Notiz dahinter.
4. Neu entdeckte Verbesserungen unten als ⬜ ergänzen.
