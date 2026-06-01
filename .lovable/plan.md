## Ziel

Wenn eine Notiz eine angehängte PDF enthält, soll sie im Editor als **eingebettete Vorschau (Iframe)** erscheinen – nicht nur als blauer Link.

## Diagnose

Stand der Notiz `Abiturzeugnis`: Im DB-Inhalt steht
`[Abitur Zeugnis Michael Zelbel.pdf](#)`
– ein normaler Markdown-Link mit `href="#"`. Zwei Probleme:

1. **Insertion-Pfad verliert die Datei-Referenz.** Wenn eine PDF als Obsidian-Embed `![[Datei.pdf]]` gespeichert ist, rendert `inlineMarkdown` sie als `<a href="#" data-attachment-name="...">`. Beim Speichern serialisiert der Editor das aber als `[Name](#)` und das `data-attachment-name` geht verloren → keine Vorschau möglich.
2. **Round-Trip von `pdfEmbed` ist kaputt.** Beim Speichern wird `pdfEmbed` zwar zu `![pdf](url)` serialisiert, aber `markdownToHtml` macht daraus ein `<img>`, nie wieder ein `<iframe>`. Vorschau verschwindet beim nächsten Laden.

## Lösung

### 1. PDF-Erkennung in `inlineMarkdown` (markdown → editor HTML)

In `src/utils/markdown-converter.ts`:

- `![[Datei.pdf]]` (und andere PDF-Extensions) → `<iframe data-type="pdf" data-attachment-name="Datei.pdf" src=""></iframe>` statt eines `<a>`.
- `![pdf](url)` → `<iframe data-type="pdf" src="url"></iframe>`.
- Normales `[X.pdf](#)` (Altbestand) → ebenfalls Iframe-Placeholder mit `data-attachment-name="X.pdf"`, damit der Resolver die Signed URL nachträglich einsetzen kann.
- Normales `[X.pdf](https://…)` (mit echter URL) → Iframe direkt mit dieser URL.

### 2. Resolver erweitern

In `src/lib/upload-attachment.ts` (`resolveAttachmentImagesInHtml`):
- Zusätzlich `<iframe data-attachment-name="…">` matchen und `src=""` mit der signierten URL füllen (analog zu `<img>` und `<a>`).

### 3. `PdfEmbed` Markdown-Serialisierung stabilisieren

In `src/components/notes/extensions/PdfEmbed.ts`:
- Attribut `data-attachment-name` zusätzlich speichern, damit beim Round-Trip aus dem Iframe wieder `![[Datei.pdf]]` wird, nicht `![pdf](signed-url-die-abläuft)`.

In `src/utils/markdown-converter.ts` Serializer-Case `pdfEmbed`:
- Wenn `data-attachment-name` gesetzt ist → `![[Datei.pdf]]` ausgeben (Obsidian-kompatibel, stabil).
- Sonst Fallback `![pdf](url)`.

### 4. FileUploadHandler

In `src/components/notes/extensions/FileUploadHandler.ts`:
- Beim Insert von PDFs `data-attachment-name: filename` mitgeben, damit das gerade eingefügte Embed sofort stabil serialisiert.

## Auswirkung auf bestehende Notizen

- Die bestehende Notiz `Abiturzeugnis` zeigt nach dem Fix automatisch die PDF-Vorschau (via Fallback-Erkennung von `[X.pdf](#)` + Lookup in `note_attachments` per Dateiname).
- Keine Migration nötig.

## Test

1. Bestehende Notiz `Abiturzeugnis` neu laden → PDF erscheint als eingebetteter Viewer.
2. Neue PDF per Drag-&-Drop in eine Notiz ziehen → Vorschau erscheint sofort, bleibt nach Reload erhalten.
3. PDF per Embed-Toolbar (URL) einfügen → Vorschau erscheint, bleibt nach Reload erhalten.
