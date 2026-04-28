Plan zur Stabilisierung der rechten Personen-Schublade in Gruppen

Ich würde das Layout in `src/pages/GroupDetail.tsx` gezielt so ändern, dass die unteren Buttons nicht mehr hoch- oder runterrutschen, wenn die Next-Steps-Abfrage fertig wird.

Umsetzung:

1. Next-Steps-Ladezustand kompakter machen
   - Der aktuelle Loader nutzt `py-6` und reserviert dadurch deutlich mehr Höhe als der spätere Text `No next steps yet.`
   - Ich ersetze ihn durch eine einzeilige Loading-Zeile, z. B. `Loading next steps...` mit kleinem Spinner.
   - Diese Zeile bekommt ungefähr dieselbe Höhe wie der spätere Empty-State-Text.

2. Stabile Mindesthöhe für den Next-Steps-Inhaltsbereich
   - Der Bereich unter der Überschrift „Next Steps“ bekommt eine kleine feste Mindesthöhe, die für Loader, Empty-State und kurze Inhalte gleich bleibt.
   - Ergebnis: Wenn von Loader zu „No next steps yet.“ gewechselt wird, verändert sich die Gesamthöhe praktisch nicht mehr.

3. Optional kleine Textkorrektur/Polish
   - Falls im UI wirklich `NoNextStepsYet` ohne Leerzeichen auftaucht, korrigiere ich das zu `No next steps yet.`
   - Die Buttons `Archive` und `Remove` bleiben an derselben Stelle, solange keine echte Next-Step-Liste nachgeladen wird.

Technische Details:

- Änderung nur in `NextStepsSection` innerhalb von `src/pages/GroupDetail.tsx`.
- Kein Backend-Change nötig.
- Kein Datenmodell-Change nötig.
- Die Query darf weiterhin beim Öffnen der Schublade laden; der Fix ist rein layoutseitig und risikoarm.

Geplantes Zielbild:

```text
Next Steps                       [Suggest] [Add]
[small spinner] Loading next steps...

Source Notes
No source notes.

[Archive] [Remove]
```

wird nach dem Laden zu:

```text
Next Steps                       [Suggest] [Add]
No next steps yet.

Source Notes
No source notes.

[Archive] [Remove]
```

ohne sichtbares Springen der unteren Buttons.