
## Antwort vorab: Kollidieren die URLs zwischen Usern?

**Nein.** Ein kurzer Blick in die DB bestätigt das:

- `wiki_pages` hat den Unique-Index `wiki_pages_user_slug_key` auf **(user_id, slug)** — nicht auf `slug` allein.
- Alle RLS-Policies filtern strikt nach `auth.uid() = user_id` (SELECT/INSERT/UPDATE/DELETE).

Konsequenzen:
- Jeder User kann unabhängig eine Seite `paperclip` haben. Kein Konflikt.
- `menerio.com/lexicon/paperclip` löst per RLS **nur** die Seite des eingeloggten Users auf. Andere User sehen nur ihre eigene oder eine "doesn't exist yet"-Seite.
- Es gibt **keine Probing-Lücke**: Ein fremder User, der `/lexicon/paperclip` aufruft, erfährt ausschließlich, ob *er selbst* eine solche Seite hat — nie, ob jemand anderes eine hat.
- Die Seiten sind außerdem nicht öffentlich (kein anonymer Zugriff, `noIndex`), sie tauchen nicht in Suchmaschinen auf.

Fazit: Die jetzige URL-Struktur `/lexicon/<slug>` ist sicher und kollisionsfrei. Es muss nichts an URL oder Schema geändert werden. (Falls du später Public-Sharing willst, würden wir wie bei Notes einen separaten 12-stelligen Token nutzen — aber das ist nicht jetzt nötig.)

---

## Problem 1: Lexikon-interne Links öffnen in neuem Browser-Fenster

### Ursache

In `RichTextEditor.tsx` werden Wikilinks als echte `<a href="/lexicon/...">` ins Editor-DOM gerendert. Es gibt zwar einen `editorProps.handleClick`, der `preventDefault` aufruft und `onWikiLinkClick` triggert, aber im **Read-Only-Modus** (Editor `editable=false`) feuert ProseMirrors `handleClick` nicht zuverlässig — der Browser folgt dann einfach dem `<a href>` und macht einen vollen Page-Reload bzw. (bei Cmd/Ctrl/Middle-Click) einen neuen Tab. Genau das beschreibst du.

Außerdem: externe Links (z.B. YouTube) sollen weiterhin in neuem Tab öffnen — das müssen wir sauber trennen.

### Lösung

1. **`RichTextEditor.tsx`** — Click-Handling auf Container-Ebene robust machen, statt nur über ProseMirror:
   - Im Wrapper (`<EditorContent>` Parent) einen nativen `onClick`-Listener anbringen, der **immer** läuft, egal ob editable.
   - Logik: 
     - Wenn `event.target.closest('.wiki-link')` → `preventDefault()`, `onWikiLinkClick(slug)` aufrufen, **niemals** `target=_blank`-Verhalten.
     - Wenn `event.target.closest('a[href^="http"]')` und kein `.wiki-link` → externer Link, `target="_blank" rel="noreferrer"` setzen / Default-Verhalten lassen.
   - Beim Rendern in `toEditorHtml`: `wiki-link`-Anker bekommen **kein** `target`. External-Links werden vom `LinkExt` schon mit `target="_blank"` versehen (oder explizit dort konfigurieren).

2. **`WikiLinkMark.ts`** — sicherstellen, dass beim Rendern kein `target` Attribut gesetzt wird (bereits ok, nur bestätigen). Optional: `rel="noopener"` weglassen, damit klar ist, dass es interne Links sind.

3. **`WikiPage.tsx`** — `onWikiLinkClick` bleibt bestehen und ruft `navigate('/lexicon/<slug>')` auf, also SPA-Navigation ohne Reload. Cmd/Ctrl/Middle-Click sollen weiterhin "in neuem Tab öffnen" auf dem internen Link funktionieren — das ist Standard-Browser-Verhalten und gewünscht (User kann bewusst neuen Tab erzwingen). Wir verhindern nur den Default bei normalem Klick.

4. **Linkify in Notes-Editor**: gleiche Container-Click-Logik anwenden, falls Wikilinks im Note-Editor (NoteEditor) ähnlich klickbar sind. Kurzcheck ob `WikilinkExtension.ts` (Notes) das gleiche Verhalten hat — der nutzt schon `extension.options.onNavigate`, ist also ok.

### Zu ändernde Dateien

- `src/components/RichTextEditor.tsx` — Container-Click-Handler hinzufügen, externe vs. interne Links trennen.
- `src/components/editor/WikiLinkMark.ts` — Bestätigen, dass kein `target` gesetzt wird.
- (optional) `src/index.css` — `.wiki-link { cursor: pointer; }` falls noch nicht.

---

## Problem 2: URL-Struktur (per User)

Wie oben beantwortet: **keine Änderung nötig**. Wir dokumentieren das nur kurz inline als Kommentar in `WikiPage.tsx` für zukünftige Klarheit, damit niemand versehentlich global-eindeutige Slugs annimmt.

---

## Out of scope

- Public-Sharing von Lexikon-Seiten (würde eigenes Token-Schema erfordern, bei Bedarf separat).
- Änderung der DB-URLs oder Slug-Generierung.

Soll ich das so umsetzen?
