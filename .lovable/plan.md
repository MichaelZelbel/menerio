# Performance-Optimierungen für den Browser

Ziel: Die App fühlt sich im Browser flüssiger an — schnellerer Start, weniger Ruckler beim Scrollen und Tippen, geringere Speichernutzung. **Keine sichtbare Funktionalität wird entfernt oder geändert.**

Die Maßnahmen sind nach Wirkung sortiert. Jede ist isoliert und kann einzeln zurückgerollt werden.

---

## 1. NoteList virtualisieren (größter spürbarer Gewinn)

`src/components/notes/NoteList.tsx` rendert heute jede Notiz als DOM-Knoten. Bei 200+ Notizen (typische Vault-Größe) entstehen tausende DOM-Elemente mit `formatDistanceToNow`, Icons und Hover-Listenern — das macht Scrollen und das Wechseln der Auswahl spürbar zäh.

- `@tanstack/react-virtual` einführen (klein, ~5 KB, bereits Peer-kompatibel).
- Nur sichtbare Zeilen + ein kleiner Overscan rendern.
- Verhalten bleibt identisch (Klick, Tastatur-Navigation, Hover-Copy-Button, Selection-Highlight).
- Edgecase „leere Liste" weiter unterstützen.

## 2. Re-Renders in der Notizenliste senken

- `NoteList` in `React.memo` packen und einen stabilen `onSelect` (in `Notes.tsx` per `useCallback`) übergeben.
- Die einzelne Zeile in eine memoisierte Sub-Komponente `NoteListItem` extrahieren, sodass das Auswählen einer Notiz nur die zwei betroffenen Zeilen neu rendert statt der ganzen Liste.
- `formatDistanceToNow` einmal pro Zeile berechnen, nicht erneut bei jedem Parent-Render.

## 3. Header-/Overlay-Backdrop-Blur ersetzen oder begrenzen

`backdrop-blur-[14px]` im `Header` läuft auf jedem Frame und ist laut bekanntem Performance-Pattern ein Hauptverursacher von Jank, besonders während Scroll-Animationen.

- Header: `backdrop-blur` entfernen, stattdessen leicht erhöhte Opazität des Hintergrunds (z. B. `bg-[rgba(255,255,255,.96)]`) + sehr feine `border` für den „Glas"-Look. Optisch fast identisch, aber kein Per-Frame-Resampling.
- `QuickCapture`-Overlay und `MediaAnalysisOverlay`: `backdrop-blur-sm` durch eine etwas dunklere/opakere Backdrop-Farbe ersetzen.
- `People.tsx` Sticky-Header: dito.

## 4. `ProfileIcon` aufhören, jedes Icon einzeln zu lazy-laden

`src/components/profile/ProfileIcon.tsx` nutzt `lucide-react/dynamicIconImports` mit `React.lazy` pro Icon. Jedes Icon erzeugt einen separaten Netzwerk-Chunk + Suspense-Übergang — sichtbar als Flackern und viele kleine Requests.

- Auf einen kuratierten statischen Map-Import der tatsächlich verwendeten Icons umstellen (bestehende Icon-Auswahl im Profile-Bereich auflisten und nur die importieren).
- Fallback auf `Circle` bleibt.
- Resultat: deutlich weniger Requests, kein Suspense-Flackern, Bundle wächst nur minimal, weil dieselben Icons schon anderswo via Tree-Shaking enthalten sind.

## 5. Build-/Bundle-Splitting verbessern

`vite.config.ts` bündelt aktuell nur `vendor`, `ui`, `query`. Tiptap, framer-motion und lucide-react landen ungesplittet im großen Hauptchunk.

- Manual chunks ergänzen für `tiptap` (`@tiptap/*`), `editor-extras` (`framer-motion`, `date-fns`), und `icons` (`lucide-react`).
- Resultat: kleinerer Initial-Chunk → schnellerer Time-to-Interactive auf Routen ohne Editor.

## 6. Defensive Aufräumarbeiten in `NoteEditor`

`NoteEditor.tsx` (1252 Zeilen) hält 4 Timer-Refs und mehrere `useEffect`-Hooks.

- Sicherstellen, dass alle `setTimeout`s in einem zentralen Cleanup beim Unmount **und** beim Wechsel der `noteId` gecleart werden (Teil-Leck heute möglich → führt zu „Geist-Saves" und CPU-Last beim schnellen Notizenwechsel).
- Keine Logik-Änderung, nur striktere Cleanup-Hygiene.

## 7. `console.log`-Rauschen im Prod entfernen

Build-Schritt: `esbuild.drop: ['console', 'debugger']` für Production-Build in `vite.config.ts` setzen. Schont Hauptthread und Speicher, vor allem in Routinen mit häufigen Logs (Editor, Sync). Dev bleibt unberührt.

---

## Was NICHT geändert wird

- Keine Features, keine Routen, keine Datenmodelle.
- Keine UI-Texte, keine Farben außer minimaler Anpassung der Header-Opazität.
- Kein Eingriff in Edge Functions, Auth, RLS oder Supabase-Client.
- Keine neuen großen Abhängigkeiten außer `@tanstack/react-virtual` (sehr klein, vom selben Maintainer wie `react-query`, das ihr bereits nutzt).

## Reihenfolge der Umsetzung

1. NoteList virtualisieren + memoisieren (Punkte 1 + 2)
2. Backdrop-Blur ersetzen (Punkt 3)
3. ProfileIcon statisch (Punkt 4)
4. Vite chunks + console-drop (Punkte 5 + 7)
5. NoteEditor-Cleanup (Punkt 6)

Nach jedem Schritt kurze visuelle Prüfung; falls etwas anders aussieht als gewünscht, isoliert revertierbar.

## Erwartete Wirkung

- Spürbar flüssigeres Scrollen in der Notizliste (vor allem ab ~100 Notizen).
- Kein Header-Jank mehr beim Scrollen.
- Schnellerer initialer Seitenaufbau auf Dashboard/Landing (kleinerer Hauptchunk, weniger Icon-Requests).
- Geringere CPU-Last beim Tippen im Editor.
