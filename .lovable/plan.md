## Problem

Im Lexikon (`WikiPage.tsx` → `RichTextEditor`) öffnen einige Links derzeit ein neues Browserfenster, obwohl sie auf interne Ziele zeigen. Ursache liegt in `RichTextEditor.tsx`, Funktion `handleContainerClick`:

```ts
if (anchor && /^https?:\/\//i.test(anchor.getAttribute("href") || "")) {
  if (!anchor.getAttribute("target")) anchor.setAttribute("target", "_blank");
  ...
}
```

Diese Logik prüft nur, ob die URL mit `http(s)://` beginnt — sie unterscheidet nicht zwischen externer und gleicher Origin. Folgen daraus:
- Ein als voll-qualifizierte URL gespeicherter Link wie `https://menerio.com/lexicon/foo` oder `https://menerio.com/dashboard/notes/...` bekommt `target="_blank"` und öffnet ein neues Fenster.
- Wikilinks (`.wiki-link` mit `href="/lexicon/..."`) funktionieren bereits korrekt über `onWikiLinkClick`.
- Relative Links (`/lexicon/foo`) bekommen kein `_blank`, lösen aber einen vollen Page-Reload aus statt SPA-Navigation.

## Lösung

In `RichTextEditor.tsx` die Klick-Behandlung von Anker-Tags so ändern, dass:

1. **Same-Origin-Erkennung:** Anker-Href via `new URL(href, window.location.href)` parsen. Wenn `url.origin === window.location.origin` → als intern behandeln. Sonst → extern.
2. **Externe Links:** `target="_blank"` + `rel="noreferrer noopener"` setzen (wie bisher), Default-Verhalten zulassen.
3. **Interne Links:** `target` entfernen, `event.preventDefault()`, dann via neuem optionalen Callback `onInternalNavigate(path)` an den Aufrufer melden. Modifier-Tasten/Mittelklick respektieren (kein preventDefault), damit "in neuem Tab öffnen" weiterhin manuell möglich bleibt.
4. **Fallback:** Wenn kein `onInternalNavigate` übergeben wird, einfach `window.location.assign(url.pathname + url.search + url.hash)` ausführen — das erzeugt zumindest keine neue Tab-/Fensteröffnung.

In `WikiPage.tsx` den `RichTextEditor` mit dem neuen Prop versorgen:
```tsx
onInternalNavigate={(path) => navigate(path)}
```

So nutzen interne Lexikon-Links (`/lexicon/...`), Notizen-Links (`/dashboard/notes/...`) und alle anderen App-Routen die SPA-Navigation und bleiben im selben Fenster.

### Technische Details

- **Datei:** `src/components/RichTextEditor.tsx` — Props-Interface erweitern um `onInternalNavigate?: (path: string) => void`. Funktion `handleContainerClick` umschreiben.
- **Datei:** `src/pages/WikiPage.tsx` — `onInternalNavigate={(path) => navigate(path)}` an `<RichTextEditor>` übergeben.
- **Hash-Links** (`#section`) werden als intern behandelt, lösen aber kein Routing aus — Browser-Default für Anchor-Scroll greift.
- **Mailto/Tel/etc.:** Werden nicht angefasst (nur `http(s):` URLs werden umgeschrieben), Default-Browserverhalten gilt.

### Out of Scope

- Note-Editor (`NoteEditor.tsx` nutzt einen anderen Pfad mit `WikilinkExtension`, dort ist das Verhalten bereits korrekt). Falls dort dieselbe Korrektur sinnvoll ist, kann sie analog nachgezogen werden — aktuell beschwert sich der Bericht aber nur über das Lexikon.
