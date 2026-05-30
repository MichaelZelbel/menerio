# PDF/Media-Flow reparieren

Vier konkrete Probleme, vier gezielte Fixes — alles im Frontend, keine Edge-Function-Änderungen.

## 1. Retry-Button reagiert sofort sichtbar

**Problem:** Klick auf "Retry" zeigt keinerlei Reaktion; man weiß nicht, ob etwas läuft.

**Fix:**
- `useReanalyzeMedia` so erweitern, dass pro `storage_path` der Pending-Status getrackt wird (statt eines globalen `isPending`).
- Im Retry-Button (Media Library **und** im MediaAnalysisOverlay innerhalb der Notiz):
  - während der Mutation: Spinner + Label "Retrying…", Button `disabled`
  - sofort optimistisch den `analysis_status` der Karte auf `processing` setzen → Badge wechselt unmittelbar von rot auf den Lade-Spinner

## 2. Status springt ohne manuellen Reload auf Grün

**Problem:** MediaLibrary-Query refetcht nie automatisch.

**Fix:** In der `useQuery` für `media-library` ein `refetchInterval` ergänzen, das alle 5 s pollt, solange mindestens ein Item `pending` oder `processing` ist — analog zum bereits existierenden Pattern in `useMediaAnalysis`.

## 3. Volltext + Vorschau direkt aus der Media Library

**Problem:** Beschreibung ist `line-clamp-2`, kein Bild/PDF sichtbar, Klick navigiert weg, ohne dass man den extrahierten Inhalt jemals zu sehen bekommt.

**Fix:** Neuer `MediaDetailDialog` (shadcn `<Dialog>`), der beim Klick auf eine Karte aufgeht statt direkt zur Notiz zu navigieren:
- Linke Seite: echte Vorschau
  - Bild → `<img>` mit Signed URL
  - PDF / `pdf_page` → `<iframe>` mit Signed URL (`#toolbar=0&view=FitH`), Fallback auf File-Icon bei Ladefehler
- Rechte Seite:
  - Originaldateiname, Seitenzahl (bei `pdf_page`), Content-Type
  - **Description** (full)
  - **Extracted text** (scrollbar, monospaced, `whitespace-pre-wrap`)
  - Topics als Badges
  - Buttons: "Open note" (navigiert zur Notiz) und "Retry analysis" (bei `failed`)

Die Karten-Kachel erhält zusätzlich für PDFs eine `iframe`-Mini-Vorschau (mit `pointer-events: none`), damit die graue Icon-Wand verschwindet.

## 4. Inhalt ist auch in der Notiz selbst sichtbar

**Problem:** OCR-Text liegt nur in `media_analysis`. In der Notiz erscheint nichts davon — das bisherige `MediaAnalysisOverlay` zeigt nur ein kleines "AI"-Badge auf dem eingebetteten Element, was Nutzer nicht finden.

**Fix:** Neue Komponente `NoteAttachmentsPanel` unterhalb des Editors:
- Listet alle `media_analysis`-Einträge der aktuellen Notiz auf, gruppiert pro Datei (PDF-Seiten zu einem Eintrag zusammengefasst).
- Pro Eintrag: Thumbnail (Bild oder PDF-iframe), Dateiname, Status-Badge.
- Aufklappbar (`<Collapsible>`) → zeigt Description, full Extracted Text, Topics.
- Bei `failed`: Retry-Button mit demselben Pending-State wie oben.

So ist garantiert, dass jeder OCR-Text aus einer Notiz heraus lesbar ist — unabhängig davon, ob der TipTap-Embed das PDF/Bild korrekt rendert oder nicht.

## Technische Details

**Geänderte/neue Dateien:**
- `src/hooks/useMediaAnalysis.ts` — `useReanalyzeMedia` erweitern um `pendingPaths: Set<string>` (oder `isPathPending(path)`); optimistisches Update von `media-library` und `media-analysis` Caches via `onMutate`.
- `src/pages/MediaLibrary.tsx`:
  - `refetchInterval` ergänzen
  - PDF-Kachel: `iframe`-Vorschau statt nur Icon
  - Card-Klick öffnet neuen Dialog statt `navigate`
  - Retry-Button mit Spinner/Disabled-State
- `src/components/media/MediaDetailDialog.tsx` (neu) — Vorschau + Volltext + Topics + Actions.
- `src/components/notes/NoteAttachmentsPanel.tsx` (neu) — wird in der Notiz-Seite (`src/pages/Notes.tsx` o. ä., wird beim Implementieren lokalisiert) unterhalb des Editors gemountet.
- `src/components/notes/MediaAnalysisOverlay.tsx` — Retry-Button-Spinner-Pattern angleichen.

**Nicht im Scope:**
- Änderungen an `analyze-media`/`analyze-pdf` Edge Functions oder am Mistral-Pipeline-Flow.
- Migration der PDF-Storage-Struktur.
- Neue Datenfelder in `media_analysis`.

Nach diesen Änderungen: Retry gibt sofort Feedback → Badge wird automatisch grün → ein Klick auf die Karte zeigt PDF + vollständigen Text → derselbe Inhalt ist auch direkt in der Notiz unter dem Editor sichtbar.