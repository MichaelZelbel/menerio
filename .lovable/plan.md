## Befund

Der verlinkte GitHub Actions Run `25865141910` schlägt nicht beim Deployment selbst fehl, sondern im CI-Workflow `CI`, Schritt `npm run lint`.

Konkret lässt sich der Fehler lokal reproduzieren:

```text
supabase/functions/draft-event/index.ts
84:79  error  Unexpected control character(s) in regular expression: \x00, \x1f  no-control-regex
```

Ursache: Bei der letzten Reparatur der `suggest-title`/`draft-event`-Fehlerbehandlung wurde eine Regex zur Entfernung von Steuerzeichen eingefügt:

```ts
.replace(/[\x00-\x1F\x7F]/g, " ")
```

ESLint verbietet solche Control-Character-Ranges standardmäßig (`no-control-regex`). Deshalb beendet GitHub Actions den Lauf nach `npm run lint`; `npm test` und `npm run build` werden danach übersprungen.

Warum es „andauernd“ wiederkommt:

- Lovable/Preview kann funktionieren, obwohl GitHub CI scheitert, weil CI zusätzlich `npm run lint` ausführt.
- Der Workflow behandelt Warnungen toleranter, aber echte ESLint-Errors blockieren weiterhin.
- Einige Fixes wurden funktional korrekt umgesetzt, aber nicht gegen den GitHub-CI-Lint-Schritt validiert.
- Zusätzlich liegen aktuell noch zwei Security-Scan-Findings vor, die nicht denselben CI-Fehler verursachen, aber weitere Folgearbeiten betreffen: GitHub Token im Browser und MCP `currentUserId` Race.

## Plan

1. **Aktuellen CI-Blocker beheben**
   - In `supabase/functions/draft-event/index.ts` die Control-Character-Regex so umschreiben, dass ESLint `no-control-regex` nicht mehr anschlägt.
   - Funktional bleibt das Ziel gleich: ungültige Steuerzeichen vor dem JSON-Parse-Fallback entschärfen.

2. **CI-Stabilität lokal prüfen**
   - `npm run lint -- --quiet` ausführen, um echte Errors zu prüfen.
   - Bei Bedarf die direkt dadurch sichtbaren Folgefehler beheben.
   - Keine breiten Refactors, nur CI-blockierende Fehler.

3. **GitHub-spezifische Sicherheitsfindings separat einplanen**
   - Danach die zwei Security-Findings angehen:
     - GitHub PAT nicht mehr im Browser auslesen/verwenden; Version-History und File-at-Commit über Edge Function proxyen.
     - MCP `currentUserId` aus dem Modulzustand entfernen und request-scoped durchreichen.
   - Diese beiden Punkte sind echte Sicherheits-/Architekturthemen und sollten nicht mit dem kleinen Lint-Fix vermischt werden.

## Erwartetes Ergebnis

Der nächste GitHub Actions Lauf sollte mindestens über `npm run lint` hinauskommen. Falls danach Tests oder Build scheitern, sind das separate CI-Stufen, die dann anhand ihrer konkreten Logs behoben werden.