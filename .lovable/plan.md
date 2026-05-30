## Ergebnis der Prüfung

Der konkrete Re-Analyse-Job für die DB-Rechnung ist serverseitig nicht hängen geblieben.

Belege aus Supabase:
- `analyze-pdf` wurde um `14:47:08` gestartet.
- `analyze-media` meldete um `14:47:12` erfolgreich `complete`.
- In `media_analysis` stehen für das PDF zwei Seiten als `complete`:
  - Seite 1: extrahierter Text vorhanden (`1895` Zeichen), Tags vorhanden
  - Seite 2: extrahierter Text vorhanden (`489` Zeichen), Tags vorhanden
- Es gibt aktuell keine `pending` oder `processing` Records für diesen User.

Die Endlosschleife ist daher sehr wahrscheinlich kein OCR-/Mistral-/Backend-Timeout, sondern ein Frontend-Statusproblem im Retry-Polling.

## Tatsächliche Ursachen

1. **Retry bleibt clientseitig künstlich pending**
   - `useReanalyzeMedia` entscheidet anhand von `updated_at`, ob ein Retry nach dem Klick frisch abgeschlossen wurde.
   - Die Media-Library-Query lädt aber aktuell kein `updated_at` aus `media_analysis`.
   - Bei einem Retry werden bestehende Rows aktualisiert, ihre `created_at` bleibt alt.
   - Nach dem Refetch fehlt dem Client dadurch der frische Timestamp und `isPathPending()` kann den Job nicht sauber als beendet erkennen.

2. **Das gleiche PDF ist wirklich doppelt vorhanden**
   - In `note_attachments` existieren zwei Dateien mit unterschiedlichem `storage_path`, aber identischem `sha256` und identischer Größe:
     - `DB_Rechnung_442370408353.pdf`
     - `DB_Rechnung_442370408353-2.pdf`
   - Die Media Library gruppiert aktuell nur nach `note_id + storage_path`, nicht nach Datei-Hash.
   - Deshalb erscheinen identische Dateien doppelt.

3. **Unterschiedliche Tags bei identischem PDF sind erwartbar, solange doppelt analysiert wird**
   - Beide Uploads werden separat durch AI analysiert.
   - Die Zusammenfassung/Tag-Erzeugung ist nicht deterministisch genug, um bei zwei separaten Läufen garantiert identische Tags zu erzeugen.

4. **PDF-Reanalyse läuft über zwei Edge Functions**
   - Das Frontend ruft für PDFs `analyze-pdf` auf.
   - `analyze-pdf` ruft dann wiederum `analyze-media` auf.
   - Die eigentliche Arbeit passiert in `analyze-media`.
   - Das ist nicht die Hauptursache, macht den Flow aber unnötig schwer zu beobachten und fehleranfälliger.

## Fix-Plan

1. **Retry-Terminierung korrekt machen**
   - In der Media-Library-Query `updated_at` mitladen.
   - `MediaItem` entsprechend erweitern.
   - `isJobFinished()` nur auf echte frische DB-Daten beenden lassen, nicht auf alte `created_at`-Werte.

2. **Pending-State robuster aufräumen**
   - `pendingJobs` aktiv entfernen, sobald ein frisches finales Ergebnis erkannt wurde.
   - Einen sichtbaren Timeout-/Fehlerzustand anzeigen, wenn nach einer sinnvollen Zeit kein frisches Ergebnis auftaucht.
   - Dadurch bleibt der Button nicht scheinbar endlos in einem Retry-Zustand.

3. **PDFs direkt über `analyze-media` reanalysieren**
   - Den Frontend-Retry für PDFs direkt gegen `analyze-media` mit `media_type: "pdf"` schicken.
   - `analyze-pdf` kann später entweder entfernt oder nur noch als Legacy-Wrapper behalten werden.
   - Damit gibt es einen eindeutigen Job und eindeutigere Logs.

4. **Doppelte Dateien in der Media Library deduplizieren**
   - Für Media-Library-Einträge zusätzlich Attachment-Metadaten aus `note_attachments` laden (`sha256`, `size_bytes`, `filename`).
   - Gruppierung für PDFs erweitern: bevorzugt `note_id + sha256`, fallback `note_id + storage_path`.
   - Dadurch wird dasselbe PDF innerhalb einer Note nur einmal angezeigt, auch wenn es doppelt hochgeladen wurde.

5. **Retry auf die kanonische Datei anwenden**
   - Bei duplizierten Attachments eine kanonische Datei wählen, z. B. die älteste oder die mit vollständiger Analyse.
   - Retry/Re-analyze nur für diese kanonische Datei ausführen.
   - Analyse-Ergebnisse nicht mehr konkurrierend für identische Duplikate anzeigen.

6. **Optionaler Folge-Fix: Upload-Dedupe**
   - Beim Upload anhand von `sha256` prüfen, ob dieselbe Datei in derselben Note bereits existiert.
   - Wenn ja: keinen zweiten Storage-Upload und keine zweite Analyse erzeugen.
   - Das verhindert neue Dubletten an der Quelle.

## Validierung nach Umsetzung

- Retry einer kleinen PDF-Rechnung startet sichtbar mit `Retrying…`.
- Nach Abschluss verschwindet der Pending-State automatisch ohne manuellen Refresh.
- Supabase zeigt keine `processing`-Altlasten.
- Die Media Library zeigt identische PDFs innerhalb derselben Note nur einmal.
- Tags/Beschreibung stammen von einem kanonischen Analyseergebnis und springen nicht zwischen Duplikaten.