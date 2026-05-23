## Status
Die Timeline-Seite (`/dashboard/timeline`) hat aktuell nur Filter (Impact, Confidence, Status, Personen). Eine Textsuche nach Momenten existiert noch nicht — also: noch nicht implementiert, lässt sich aber sauber ergänzen.

## Plan: Suchfeld in der Timeline

### UX
- Suchfeld in der Header-Zeile neben dem "Filters"-Button (links davon), mit Lupen-Icon und Placeholder „Search moments…".
- Client-seitige Filterung der bereits geladenen Momente — kein zusätzlicher DB-Roundtrip, sofort responsiv.
- Case-insensitive, matched gegen **Titel** und **Beschreibung**.
- Leeres Suchfeld = alle Momente (wie heute).
- Trefferanzahl im bestehenden „X moments shown"-Text bleibt korrekt, da Suche Teil des `filteredMoments`-Memos wird.
- „Show All"-Button im Filter-Panel setzt auch das Suchfeld zurück.
- Wenn kein Treffer: bestehender Empty-State wird angepasst, sodass bei aktiver Suche „No moments match your search" angezeigt wird (statt „No moments yet").

### Technisch
- Neuer State `searchQuery: string` in `TimelinePage.tsx`.
- `filteredMoments` erweitern: Wenn `searchQuery.trim()` nicht leer, filtern auf `title.toLowerCase().includes(q)` ODER `description?.toLowerCase().includes(q)`.
- `clearFilters` setzt zusätzlich `setSearchQuery("")`.
- Input-Komponente: bestehendes `@/components/ui/input` mit `Search`-Icon (lucide-react) als Adornment.
- Keine Änderungen an Datenbank, Edge Functions oder Typen nötig.

### Optional (nicht in diesem Schritt, nur erwähnt)
- Später erweiterbar auf Suche in Teilnehmer-Namen oder Provenance-Snippets — bewusst nicht jetzt, um den Scope klein zu halten.

### Geänderte Datei
- `src/pages/TimelinePage.tsx`
