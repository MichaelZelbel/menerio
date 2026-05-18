# Pricing-Reste entfernen

## Status der Prüfung

- Keine `/pricing` Route in `src/App.tsx`
- Keine Pricing-Page-Datei unter `src/pages/`
- Keine Links auf Pricing im Header oder Footer
- Keine sonstigen Treffer für "pricing" im Code

**Einzige verbliebene Erwähnungen:** in `src/content/docs/registry.tsx` im FAQ-Doc:
- Heading-Eintrag `{ id: "pricing", title: "Pricing" }`
- `searchText` enthält die Wörter `pricing free premium`
- Sektion `<h2 id="pricing">Pricing</h2>` mit zwei Q&As zu "Free plan" und "Premium"

## Änderung

In `src/content/docs/registry.tsx` (FAQ-Doc):

1. Heading-Eintrag `pricing` aus dem `headings`-Array entfernen.
2. `searchText` bereinigen — `pricing free premium` entfernen.
3. Den gesamten Block ab `<h2 id="pricing">Pricing</h2>` bis einschließlich der Premium-Antwort löschen (zwei Q&As).

Sonst keine weiteren Änderungen — alle anderen Spuren von Pricing sind bereits weg.
