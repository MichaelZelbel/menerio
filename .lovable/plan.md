Ich habe nachgesehen: Für Planinio ist bisher offenbar nicht viel Spezifisches gebaut. Planinio taucht vor allem im App-Katalog, in Doku-Texten und in generischer External-Note-/Connected-App-Logik auf. Es gibt keine große eigene Planinio-Fachlogik, die wir stark verlieren würden. Wenn Planinio später kommt, können wir es sauber neu aufsetzen.

Bei Temerio, Cherishly und Clarinio ist dagegen deutlich mehr spezifischer Code vorhanden:
- Temerio: Event-Erstellung aus Notes, `send-to-temerio`, `CreateEventDialog`, Review-Queue-Vorschläge, Global Create Button, Moment-Spiegelung in `receive-note`.
- Cherishly: Review-Queue-Vorschläge und People-App-Mapping.
- Clarinio: Profile-Sync über `push-profile` / `receive-profile` und Admin-Button im Profil.

Ich würde deshalb jetzt einen sauberen Cut machen: Im Produktcode bleibt nur Querino als bekannte App-Integration.

Umsetzung:

1. App-Katalog auf Querino reduzieren
   - In `AppIntegrations.tsx` entferne ich Temerio, Cherishly, Clarinio und Planinio aus `KNOWN_APPS`.
   - Der Apps-Tab zeigt dann nur noch Querino.
   - Custom-App-Erstellung entferne oder verstecke ich, damit nicht indirekt wieder Cherishly/Temerio/sonstige Apps auftauchen.

2. Temerio-spezifische UI entfernen
   - Entfernen des „Create event in Temerio“-Buttons im Note Editor.
   - Entfernen von „New Event (Temerio)“ im globalen New-Menü.
   - Entfernen des `CreateEventDialog` aus verwendeten UI-Flows.

3. Review Queue bereinigen
   - Entfernen der Suggestion-Typen `add_event_temerio` und `add_event_cherishly` aus Frontend und `process-note`.
   - Die Review Queue bleibt für People/Profile/Relationships/Links erhalten.
   - Neue KI-Vorschläge erzeugen keine Temerio-/Cherishly-Aktionen mehr.

4. People/Profile bereinigen
   - Entfernen des Admin-only „App Identity Mapping“ für Cherishly/Temerio auf der People-Seite.
   - Entfernen des „Sync to Clarinio“-Buttons und der zugehörigen Profile-Sync-Mutation.

5. Edge Functions und Config bereinigen
   - Entfernen der spezifischen Funktionen `send-to-temerio`, `push-profile`, `receive-profile`, sofern sie nicht mehr anderweitig genutzt werden.
   - Entfernen der entsprechenden Einträge aus `supabase/config.toml`.
   - Entfernen der Temerio-Moment-Spiegelung aus `receive-note`.
   - Die generischen Funktionen für Querino-kompatibles Note-Inbound/Outbound bleiben erhalten, soweit sie Querino unterstützen.

6. Doku und Hilfetexte aktualisieren
   - Entfernen von Temerio/Cherishly/Clarinio/Planinio aus App-Integrations-Dokumentation und Test-Szenarien.
   - Texte auf „Querino“ bzw. generisch „external notes“ anpassen, wo sinnvoll.

7. Projekt-Memory aktualisieren
   - Festhalten: Aktuell ist nur Querino als App-Integration vorgesehen.
   - Temerio und Cherishly sollen nicht wieder eingebaut werden.
   - Planinio ist höchstens später möglich und wird dann neu geplant.

Technische Einschätzung zu Planinio:
- Der Verlust ist gering.
- Der bisherige Planinio-Code scheint überwiegend Registry-/Doku-/Generic-Sync-Nutzung zu sein.
- Wenn Planinio später kommt, müssen wir vor allem wieder einen bekannten App-Eintrag, Mapping-Regeln und ggf. UX-Flows ergänzen. Das ist überschaubarer und sauberer als jetzt halbfertige Integrationen mitzuschleppen.

Validierung:
- Danach suche ich projektweit erneut nach `Temerio`, `Cherishly`, `Clarinio`, `Planinio` und den lowercase Varianten.
- Erwartung: Keine produktseitigen Treffer mehr außer eventuell historische Migrationen oder bewusst generische Datenfelder.
- Anschließend läuft `tsc --noEmit`, um TypeScript-Fehler durch entfernte Imports/Komponenten auszuschließen.