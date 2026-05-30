## Ziel
Den PDF/Media-Analyse-Flow so umbauen, dass ein Dokument in der Media Library als ein logisches Item erscheint, Retry sichtbar und eindeutig läuft, und der Status sauber terminiert.

## Befund
- Die „Duplikate“ sind aktuell PDF-Seiten: Für ein 2-seitiges PDF liegen zwei `media_analysis`-Records mit identischem `storage_path`, aber unterschiedlicher `page_number` vor. Die Media Library rendert diese Records einzeln, deshalb wirkt dasselbe Dokument doppelt.
- Retry wird pro `storage_path` gestartet. Wenn zwei Karten denselben `storage_path` haben, schalten beide gleichzeitig auf denselben Pending-Zustand.
- Die Frontend-Erkennung `hasFreshFinalResult(...)` beendet den Pending-Zustand schon beim ersten frischen `complete`-Record. Bei PDFs mit mehreren Seiten ist das zu grob und kann inkonsistente UI-Zustände erzeugen.
- Backend-seitig werden bei Retry alte Records gelöscht, ein Placeholder geschrieben, danach neue Page-Records eingefügt und der Placeholder gelöscht. Dadurch gibt es kurzzeitig keinen stabilen „Job“-Record; die UI muss das unnötig erraten.

## Umsetzung

### 1. Media Library nach Dokument gruppieren
- `src/pages/MediaLibrary.tsx` zeigt künftig ein PDF nur noch einmal pro `note_id + storage_path`.
- Page-Records werden zu einem Dokument-Item zusammengeführt:
  - Status: `failed` schlägt `processing`, `processing/pending` schlägt `complete`.
  - Beschreibung/Text: Seiten werden sortiert nach `page_number` zusammengeführt.
  - Topics: dedupliziert über alle Seiten.
  - Anzeige: klare Info wie „2 pages“ statt zwei separate Karten.
- Suche und Statistiken basieren auf diesen gruppierten Items, nicht mehr auf Roh-Records.

### 2. Retry-State an ein logisches Dokument binden
- `useReanalyzeMedia` bleibt storage-path-basiert, aber die Terminierung wird robuster:
  - Pending endet nur, wenn nach dem Retry kein `processing/pending` Record mehr für diesen `storage_path` existiert und mindestens ein frisches finales Ergebnis (`complete` oder `failed`) vorhanden ist.
  - Dadurch beendet nicht mehr eine einzelne fertige PDF-Seite den Job zu früh.
- Polling läuft weiter, solange ein Retry-Job offen ist oder DB-Records `processing/pending` sind.

### 3. Backend-Flow atomarer machen
- In `supabase/functions/analyze-media/index.ts` wird Retry nicht mehr über „Records verschwinden lassen“ modelliert.
- Ablauf:
  1. Vorhandene Records für `note_id + storage_path` werden auf `processing` gesetzt und inhaltlich geleert, statt sofort gelöscht.
  2. Falls keine Records existieren, wird ein Placeholder erstellt.
  3. Neue Analyse-Ergebnisse werden vorbereitet.
  4. Erst danach werden alte/Placeholder-Records ersetzt.
  5. Bei Fehler bleiben Records sichtbar und werden sauber auf `failed` gesetzt.
- Ziel: Die UI hat während des gesamten Prozesses einen stabilen Status und kann korrekt terminieren.

### 4. Detailansicht für gruppierte PDFs korrigieren
- `MediaDetailDialog` erhält das zusammengeführte Dokument-Item.
- Bei PDFs werden alle Seiteninhalte in einem Dialog angezeigt, inklusive Seitentrennern.
- Retry/Re-analyze im Dialog wirkt nur auf das eine logische Dokument.
- Der fehlende Dialog-Description-Warnhinweis wird nebenbei behoben.

### 5. Validierung
- Nach Umsetzung prüfe ich:
  - DB-Daten für das betroffene PDF: nur gruppierte Anzeige in der UI, weiterhin korrekte Page-Records in der DB.
  - Retry-Request: Status wechselt auf „Retrying/Analyzing“, bleibt dort während Verarbeitung, und endet bei finalem DB-Status.
  - Media Library zeigt dasselbe PDF nur einmal.
  - Topics/Beschreibung sind konsistent zusammengeführt statt pro Seite widersprüchlich als separate Dokumente sichtbar.

## Betroffene Dateien
- `src/hooks/useMediaAnalysis.ts`
- `src/pages/MediaLibrary.tsx`
- `src/components/media/MediaDetailDialog.tsx`
- `src/components/notes/NoteAttachmentsPanel.tsx` falls dieselbe Gruppierungslogik dort angepasst werden muss
- `supabase/functions/analyze-media/index.ts`