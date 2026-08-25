# Listen-Regel dauerhaft durchsetzen — auch im eigenen Profil

## Befund (geprüft)

Die Darstellungsregel (ein Wert = Text, mehrere Werte = Bulletliste, echte Einzelfakten bleiben zusammen) ist in der UI korrekt implementiert und wird von Kontakt- und Eigenprofil über dieselbe Komponente gerendert.

Das Problem liegt nicht in der Darstellung, sondern in den **Daten des eigenen Profils**: Von 119 Einträgen enthalten 33 Kommalisten und 7 sogar eingebettete Fremd-Labels. Beispiele aus der Datenbank:

- Feld „Website" enthält 630 Zeichen mit Straße, Postleitzahl, Geburtsort, Telefon, Discord-ID, zwei E-Mail-Adressen und acht URLs.
- Feld „Employer" enthält Jobtitel, Gehalt, Bonus und Vertragsdaten.
- Feld „Founder of company" enthält einen Duolingo-Streak.

Solche Sammel-Zeilen können gar nicht sauber als Liste dargestellt werden — sie sind mehrere Fakten in einem String, teils unter dem falschen Feld. Für Kontaktprofile wurde das bereits repariert; das eigene Profil wurde nie durch die Reparatur geschickt. Neue Schreibvorgänge sind bereits durch den Atomisierungs-Trigger geschützt, Altbestand nicht.

## Was umgesetzt wird

### 1. Altbestand des eigenen Profils reparieren
Die bestehende Reparaturroutine (`explode_bags`) mit Scope „owner" ausführen: Jede Sammel-Zeile wird in einzelne Fakten zerlegt, jeder Fakt anhand seines Typs unter dem passenden Feld neu abgelegt (E-Mail unter E-Mail, Telefon unter Telefon, Gehalt unter Gehalt), Prosa landet als „Unfiled note" statt verloren zu gehen. Anschließend Kontrolle per Datenbankabfrage, dass keine Zeile mehr Fremd-Labels oder Mehrfach-Fakten enthält.

Dabei zusätzlich abgedeckte Lücken der aktuellen Routine:
- Zeilen, die als „nicht atomisierbar" übersprungen werden, werden künftig ebenfalls zerlegt, wenn sie erkennbare eingebettete Labels (`Feld: Wert`) enthalten.
- Mehrfach-URLs/E-Mails in einem Feld werden in je eine Zeile pro Wert aufgetrennt, sodass die UI sie automatisch als Bulletliste zeigt.

### 2. Dauerhaft sauber halten
- Wiederkehrender Sweep: ein bereits vorhandener Cron-Job-Slot wird um einen nächtlichen Lauf ergänzt, der Sammel-Zeilen im eigenen Profil und in Kontaktprofilen erkennt und zerlegt — nicht nur einmalig, sondern fortlaufend.
- Sichtbarer manueller Auslöser im eigenen Profil („Profil aufräumen") mit Ergebnis-Feedback, damit der Zustand jederzeit selbst wiederherstellbar ist.

### 3. Darstellungsregel absichern
- Regressionstests erweitern: eigenes Profil und Kontaktprofil müssen für dieselben Daten identische Ausgabe erzeugen (ein Wert → Text, mehrere → Bullets, Einzelfakt-Felder wie Adresse → nie splitten).
- Ein Test, der fehlschlägt, sobald eine Profiloberfläche Werte am zentralen Renderer vorbei ausgibt.

## Technische Details

- Reparatur: `normalize-profile` Edge Function, Action `explode_bags`, `scope: "owner"` und `scope: "all_contacts"`; Erweiterung des Fallbacks für `reason === "not_atomic"` in Kombination mit `EMBEDDED_LABEL_RE` in `_shared/profile-fact-gate.ts`.
- Persistenz: `pg_cron`-Eintrag, der `explode_bags` pro Nutzer anstößt (analog zum bestehenden Wiki-Restructure-Job).
- UI: Aktion in `src/pages/Profile.tsx` / `ProfileSections.tsx`; Rendering bleibt unverändert in `ProfileValue.tsx`.
- Tests: Ergänzung in `src/lib/__tests__/profile-label-rendering.test.ts`.

## Nicht Teil dieser Änderung

Keine Änderung an Extraktionsprompts, kein Löschen von Fakten — die Reparatur ist verlustfrei, jeder Wert bleibt erhalten, nur unter dem richtigen Feld.
