## Problem

Der vorherige Fix in `RichTextEditor.tsx` prüft nur `url.origin === window.location.origin`. Lexikon-Inhalte enthalten aber häufig voll-qualifizierte URLs auf `https://menerio.com/...` oder `https://www.menerio.com/...`. Wenn die Seite aktuell auf einer anderen Origin läuft — z. B. `id-preview--…lovable.app` (Editor-Preview) oder `menerio.lovable.app` — schlägt der Vergleich fehl. Der Link wird als „extern" eingestuft, bekommt `target="_blank"` und öffnet ein neues Fenster.

Das deckt sich mit der Beobachtung des Users: Im Lexicon öffnen interne Links weiterhin ein neues Fenster.

## Lösung

Die Internal-Detection in `RichTextEditor.tsx` erweitern: Eine URL gilt als intern, wenn ihre Origin entweder gleich der aktuellen Origin ist **oder** einer bekannten App-Domain entspricht.

### Bekannte App-Hosts

Konstante `INTERNAL_APP_HOSTS` einführen mit:
- `menerio.com`
- `www.menerio.com`
- `menerio.lovable.app`
- jeder Host, der auf `.lovable.app` endet (deckt Preview-Subdomains ab)

### Geänderte Logik (in `handleContainerClick`)

```ts
const isInternalHost = (host: string) =>
  host === window.location.host ||
  INTERNAL_APP_HOSTS.includes(host) ||
  host.endsWith(".lovable.app");

if (isInternalHost(url.host)) {
  // wie bisher: target entfernen, preventDefault, onInternalNavigate(path)
} else {
  // wie bisher: target=_blank, rel
}
```

Damit werden alle Links auf `menerio.com`, `www.menerio.com` und alle `*.lovable.app`-Hosts unabhängig von der aktuellen Origin als intern behandelt. Pfad und Query bleiben erhalten und werden via `navigate(path)` durch React Router aufgelöst.

### Datei

- `src/components/RichTextEditor.tsx` — Konstante hinzufügen, `handleContainerClick` anpassen.

### Out of Scope

- `WikiPage.tsx` braucht keine Änderung — `onInternalNavigate` ist bereits verdrahtet.
- `WikiLinkMark` ist nicht betroffen (Wikilinks gehen weiterhin über `onWikiLinkClick`).
- Andere Editor-Aufrufer (`NoteEditor`) bleiben unangetastet.
