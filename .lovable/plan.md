Ich würde das so umsetzen:

1. Weekly Review wieder ins Sidebar-Menü aufnehmen
- In der Hauptnavigation kommt ein Eintrag „Weekly Review“ zurück.
- Ziel bleibt die bereits existierende Route `/dashboard/review`.
- Icon passend zur bestehenden UI, z. B. `CalendarDays` oder `BarChart3`.
- Damit ist der Punkt nicht nur in den Docs beschrieben, sondern wieder direkt erreichbar.

2. Weekly-Review-Seite verständlicher und nutzbarer machen
- Den vorhandenen Button klarer benennen, z. B. „Create Weekly Review“ oder „Generate Now“.
- Den Zeitraum-Selector beibehalten, aber so gestalten, dass der User bewusst wählt: „Last 7 days“, „Last 14 days“, „Last 30 days“.
- Den Empty State verbessern: Wenn noch keine Review existiert, wird direkt erklärt, dass man sie jederzeit manuell starten kann.
- Während der Generierung eine klare Ladeanzeige zeigen.
- Fehler wie „No notes found in this period“ freundlicher anzeigen, damit es nicht wirkt, als sei die Funktion kaputt.

3. Backend so anpassen, dass „sie wirklich passiert“
- Die Edge Function `weekly-review` existiert bereits und kann manuell Reviews erzeugen.
- Ich würde sie so erweitern, dass sie zwei Modi unterstützt:
  - manueller Modus: aktueller User triggert jederzeit eine Review für 7/14/30 Tage
  - geplanter Modus: ein Cron/Scheduled Trigger kann regelmäßig für alle User prüfen, ob eine neue Weekly Review fällig ist
- Für den geplanten Modus soll die Function nicht blind doppelte Reviews erzeugen, sondern prüfen, ob für den jeweiligen Wochenzeitraum bereits eine Review existiert.
- Wenn in einem Zeitraum keine Notizen vorhanden sind, soll das sauber als „skipped/no content“ behandelt werden statt als kaputte leere Ansicht.

4. Wöchentlichen Rhythmus etablieren
- In der bestehenden `daily-digest` Function gibt es bisher nur eine Freitags-Notification „Time for your weekly review“; sie erzeugt aber keine Review.
- Ich würde stattdessen/zusätzlich die Weekly Review automatisch erzeugen lassen, z. B. einmal wöchentlich.
- Technisch sinnvoll wäre ein geplanter Supabase-Cron-Aufruf auf die `weekly-review` Edge Function.
- Die Function erstellt dann Reviews für User mit aktivierter `notify_weekly_review`-Einstellung und schreibt danach optional eine Notification mit Link zur Review.

5. Notifications korrigieren
- Wenn eine automatische Weekly Review erzeugt wurde, bekommt der User eine Notification wie „Your weekly review is ready“ mit Link `/dashboard/review`.
- Die bestehende Reminder-Notification aus `daily-digest` sollte nicht weiterhin nur „mach mal Review“ sagen, wenn wir die Review tatsächlich automatisch erstellen. Entweder wird sie entfernt oder auf „Review ist bereit“ umgestellt.

6. Docs an die neue Realität anpassen
- Der Docs-Text „available every Sunday“ sollte angepasst werden auf: automatisch im Wochenrhythmus plus jederzeit manuell per Button.
- Die Weekly-Review-Dokumentation wird mit dem Button/Manual Trigger ergänzt.

Technische Details
- Dateien, die voraussichtlich geändert werden:
  - `src/components/layout/DashboardSidebar.tsx`: Sidebar-Eintrag hinzufügen
  - `src/pages/WeeklyReview.tsx`: UI/Empty State/Button/Fehlerhandling verbessern
  - `supabase/functions/weekly-review/index.ts`: Batch-/Scheduled-Modus, Duplikat-Prüfung, robustere Responses, Notification nach Erstellung
  - `supabase/functions/daily-digest/index.ts`: alte Reminder-Logik anpassen oder entfernen, damit keine irreführenden Notifications entstehen
  - `src/content/docs/registry.tsx`: Docs-Text aktualisieren
- Falls ein echter Wochenrhythmus direkt in Supabase eingerichtet werden soll, braucht es zusätzlich eine Cron-Konfiguration via `pg_cron`/`pg_net` mit dem Projekt-Function-URL und Anon Key. Das würde ich nicht als portable Migration ablegen, sondern projektspezifisch einrichten, weil dort konkrete Projekt-URLs/Keys enthalten sind.

Ergebnis
- „Weekly Review“ ist wieder im Sidebar-Menü sichtbar.
- User können jederzeit manuell eine Review starten.
- Es gibt eine klare leere Startansicht statt „da steht nichts“.
- Automatische Weekly Reviews werden im Wochenrhythmus erzeugt, ohne unnötige Duplikate.
- Die Dokumentation beschreibt danach exakt dieses Verhalten.