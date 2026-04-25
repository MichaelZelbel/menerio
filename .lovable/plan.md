Ich kann das importieren. Ich habe das angehängte Excel geprüft: Es enthält Temerio-Moments und Person-Tabellen. In Menerio gibt es für den aktuellen Nutzer bereits 13 Kontakte, aber noch keine Moments/Timeline-Daten. Da wir gerade im Plan-Modus sind, würde ich den Import nach deiner Freigabe direkt ausführen.

Plan:

1. Excel-Daten vollständig auslesen
   - Das Sheet `temerio_export_all.xlsx` aus dem Upload verarbeiten.
   - Alle Moment-Zeilen extrahieren: Titel, Beschreibung, Datum, Status, Impact-Level, Confidence-Werte, Kategorie, Teilnehmer, UID, timestamps.
   - Alle Person-Zeilen extrahieren: Name, relationship_label, Temerio person_uid.

2. Personen in Menerio matchen oder neu anlegen
   - Bestehende Menerio-Kontakte für den aktuellen Nutzer laden.
   - Matching-Strategie:
     - exakter Name, case-insensitive
     - Alias-Matching über `contacts.aliases`
     - einfache Normalisierung von Leerzeichen und Groß-/Kleinschreibung
   - Wenn kein Treffer existiert: neuen Kontakt in `contacts` anlegen.
   - Temerio-Zuordnung in `contacts.app_mappings` speichern, z. B. `temerio.person_uid`, damit spätere Re-Imports dieselbe Person wiederfinden.

3. Moments idempotent importieren
   - Für jede Moment-Zeile einen Eintrag in `moments` erstellen.
   - `source = 'temerio'` setzen.
   - `attachments` mit Import-Metadaten füllen, z. B. `source_app`, `source_id`/`moment_uid`, original Temerio-Felder.
   - Vor dem Einfügen prüfen, ob bereits ein Moment mit derselben Temerio-UID existiert, damit kein Duplikat entsteht.
   - Falls vorhanden: aktualisieren statt doppelt anlegen.

4. Personen mit Moments verknüpfen
   - `primary_person` wenn vorhanden als `moments.person_id` setzen.
   - Alle `participants` zusätzlich über `moment_participants` verknüpfen.
   - Wenn ein Moment nur Teilnehmer hat, wird der erste gematchte Teilnehmer als `person_id` gesetzt, damit er in der Personen-Timeline zuverlässig erscheint.

5. Ergebnis prüfen
   - Danach Datenbank prüfen:
     - wie viele Kontakte neu angelegt wurden
     - wie viele Moments importiert/aktualisiert wurden
     - wie viele Teilnehmer-Verknüpfungen erstellt wurden
   - Kurz bestätigen, welche Personen und Moments jetzt in der Timeline verfügbar sind.

Technische Details:
- Es sind keine Schema-Änderungen nötig; die Tabellen `contacts`, `moments` und `moment_participants` existieren bereits mit passenden RLS-Regeln.
- Für den Datenimport verwende ich direkte Datenoperationen, keine Migration.
- Der Import wird auf den bestehenden Menerio-Nutzer angewendet, der aktuell die vorhandenen Kontakte besitzt: `4332607c-1ddd-4a5d-8765-a44963e4fe12`.
- Der Import wird idempotent aufgebaut, damit ein erneutes Ausführen keine doppelten Moments erzeugt.