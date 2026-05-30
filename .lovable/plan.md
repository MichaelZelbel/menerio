## Ziel

Der Media-Library-Flow wird so umgebaut, dass ein Dokument aus Nutzersicht stabil an Ort und Stelle bleibt, einen echten Status zeigt und PDF-Vorschauen zuverlässig angezeigt werden.

## Was aktuell wirklich schiefläuft

1. **Die Liste hängt an `media_analysis` statt an einem stabilen Dokumentmodell.**
   - Beim Re-analyze werden Analyse-Zeilen aktualisiert/neu geschrieben.
   - Die Media Library sortiert nach `media_analysis.created_at` und gruppiert danach clientseitig.
   - Dadurch kann ein Dokument beim Retry seine Position ändern oder kurz verschwinden.

2. **Der Backend-Write ist nicht atomar genug.**
   - `writeAnalysisRecord` sucht bestehende PDF-Seiten mit `.is("page_number", value)`; für `page_number = 1/2` ist das der falsche Operator.
   - Dadurch können statt Updates neue Zeilen entstehen.
   - Danach werden alte `processing`-Zeilen gelöscht. Das erklärt Verschieben, doppelte/wechselnde Einträge und instabile Statusanzeige.

3. **Es gibt keine Datenbank-Garantie gegen doppelte Analyse-Seiten.**
   - Ohne eindeutigen Schlüssel für `(note_id, storage_path, page_number)` kann jeder Retry neue Page-Rows erzeugen.

4. **PDF-Vorschau ist derzeit kein echter Preview-Flow.**
   - In der Media Library wird für PDFs nur ein Fallback/Icon gezeigt.
   - In anderen Stellen kann die native PDF-Einbettung kaputt wirken.
   - Re-analyze löst dieses Preview-Problem nicht, weil Analyse und Preview zwei getrennte Dinge sind.

## Implementierungsplan

### 1. Datenbank absichern

Migration für `media_analysis`:

- Vorhandene Duplikate pro `(user_id, note_id, storage_path, page_number)` bereinigen.
  - Behalten wird die beste Zeile: `complete` vor `processing/failed`, danach die neueste.
- Eindeutigen Index hinzufügen:
  - `user_id`
  - `note_id`
  - `storage_path`
  - `page_number` mit `NULLS NOT DISTINCT`
- Optionaler Index für schnelle Library-Abfragen:
  - `(user_id, note_id, storage_path)`

Damit kann ein Retry nicht mehr mehrere konkurrierende Analyse-Zeilen für dieselbe PDF-Seite erzeugen.

### 2. Edge Function `analyze-media` korrigieren

- `writeAnalysisRecord` auf echtes Upsert umstellen:
  - `page_number === null` korrekt behandeln
  - `page_number !== null` mit Gleichheitsvergleich bzw. eindeutigem `onConflict`
- Bestehende Reihen nicht löschen, solange keine erfolgreichen neuen Ergebnisse vorliegen.
- Placeholder-Row nur nach erfolgreichem Abschluss entfernen.
- Fehlerzustand klar schreiben:
  - Wenn OCR/Analyse scheitert, bleiben sichtbare Zeilen erhalten und werden `failed`.
- Rückgabe/Logs eindeutiger machen:
  - `job_started_at`
  - `pages_processed`
  - `storage_path`
  - finaler Status

### 3. Media Library auf stabiles Dokumentmodell umbauen

- Dokumentgruppen bekommen einen stabilen Schlüssel:
  - bevorzugt `note_id + sha256`
  - fallback `note_id + storage_path`
- Sortierung nicht mehr nach Analyse-Erstellzeit, sondern stabil nach Upload-/Attachment-Zeit oder initialer Dokumentposition.
- Re-analyze ändert nur den Status der bestehenden Card, niemals ihre Position.
- Während Retry:
  - Card bleibt sichtbar
  - Overlay/Badge zeigt Spinner
  - Button ist deaktiviert und zeigt `Analyzing…`
  - alter Content bleibt sichtbar, bis frische Ergebnisse da sind
- Nach Abschluss:
  - Status wechselt sichtbar auf `Analyzed`
  - Button wird wieder `Re-analyze`
  - falls Analyse scheitert: `Failed` + Retry bleibt verfügbar

### 4. Pending-State sauber machen

- Pending-State nicht mehr nur nach `storage_path`, sondern nach Dokument-Key tracken.
- Abschluss erst dann markieren, wenn:
  - alle erwarteten Seiten final sind (`complete` oder `failed`)
  - mindestens eine Zeile frischer ist als Job-Start
  - keine Zeile mehr `processing`/`pending` ist
- Timeout bleibt als Fail-Safe, aber UI zeigt dann einen klaren Fehler statt endlosem Spinner.

### 5. PDF-Vorschau wirklich herstellen

- Eine eigene PDF-Preview-Komponente einführen.
- Für Karten: erste PDF-Seite als Canvas-Thumbnail rendern.
- Für Detaildialog: erste Seite bzw. Dokumentvorschau mit Ladezustand anzeigen.
- Wenn Rendering fehlschlägt:
  - Fallback nicht als kaputte Vorschau, sondern als sauberer PDF-Fallback mit `Open file`.
- Dafür `pdfjs-dist` verwenden, statt sich auf Browser-iframe-Verhalten zu verlassen.

### 6. Verifikation

Nach Umsetzung prüfen:

- Retry auf `DB_Rechnung_442370408353.pdf`.
- Card bleibt während des gesamten Vorgangs an derselben Grid-Position.
- Spinner läuft nur während echter Analyse.
- Nach Abschluss erscheint klarer Success-Status.
- Keine neuen doppelten `media_analysis`-Rows entstehen.
- PDF-Thumbnail erscheint oder fällt sauber auf PDF-Fallback zurück.
- Edge-Logs zeigen genau einen abgeschlossenen Job pro Klick.