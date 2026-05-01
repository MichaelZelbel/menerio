## Antwort vorab

Technisch beides sauber möglich. Praktisch ist aber wichtig:

- **Ein eigener Feldtyp "Link" ist nicht nötig** — es gibt bereits den Feldtyp **`url`** in Collections. Der speichert URLs validiert und rendert sie als klickbaren Link mit `ExternalLink`-Icon (siehe `FieldValue` in `CollectionDetail.tsx`, Zeilen 447–458). Das ist der saubere Weg für Felder, die *ausschließlich* eine URL enthalten.
- **Was aktuell fehlt**: In normalen `text`/`longtext`-Feldern werden URLs nur als Plain-Text dargestellt — selbst wenn sie wie eine URL aussehen. Genau das lässt sich sauber nachrüsten, ohne Schema-Migration und ohne neuen Feldtyp.

## Plan: Auto-Linkify für Text- und Longtext-Felder

### Ziel
URLs (sowie optional E-Mail-Adressen) in `text`- und `longtext`-Feldern werden in der **Anzeige** automatisch erkannt und als klickbare Links gerendert. Das Eingabe-/Speicherverhalten bleibt unverändert (Plain Text in DB).

### Scope
- Nur Anzeige-Layer (`FieldValue` in `src/pages/CollectionDetail.tsx`).
- Kein neuer Feldtyp, keine DB-Migration, keine Schema-Änderung.
- Bestehende Daten profitieren automatisch.

### Umsetzung

1. **Helper `linkifyText(text: string)`** in `src/lib/utils.ts` (oder neue `src/lib/linkify.ts`):
   - Erkennt mit Regex:
     - `https://…` / `http://…`
     - `www.…` (wird beim Rendern zu `https://www.…`)
     - E-Mail-Adressen (optional, hinter Flag)
   - Splittet den String in Segmente und gibt ein `ReactNode[]` zurück: Plain-Text-Stücke + `<a target="_blank" rel="noreferrer" class="text-primary hover:underline">` für Treffer.
   - Trailing-Satzzeichen (`.`, `,`, `)`, `]`) werden vom Link abgeschnitten und als Plain-Text angehängt.
   - Escaping: Da wir nicht `dangerouslySetInnerHTML` nutzen, sondern React-Nodes, ist XSS unkritisch.

2. **Integration in `FieldValue` (`src/pages/CollectionDetail.tsx`)**:
   - Im `text`-Branch (aktuell letzte Zeile 492 `return <span>…{truncate(value)}…`):
     - Statt `truncate(value)` → `linkifyText(String(value))` rendern (mit `truncate` nur fürs Tooltip / `title`-Attribut, nicht für die Linkify-Quelle, sonst werden URLs zerstört).
   - Für `longtext`: gleiches Verhalten, aber ohne `truncate`, damit lange Texte vollständig sichtbar/klickbar bleiben (separater Branch für `field.type === "longtext"` einführen).

3. **Klick-Verhalten innerhalb der Tabellenzeile**:
   - `onClick={(e) => e.stopPropagation()}` auf den generierten `<a>`-Tags, damit das Anklicken eines Links nicht versehentlich die Zeilenauswahl/Detailansicht öffnet.

4. **Edit-Mode bleibt unverändert**:
   - `Input` / `Textarea` zeigen weiterhin Plain Text — das ist Standard und erwartbar (vergleichbar mit Notion, Airtable).

### Was nicht enthalten ist
- Kein neuer `link`-Feldtyp (wäre redundant zu `url`).
- Kein Linkify in der Edit-Ansicht (nicht standardgemäß; würde Eingabe verkomplizieren).
- Keine Markdown-Verarbeitung in Collection-Feldern (`longtext` bleibt Plain Text — falls reichhaltige Formatierung gewünscht ist, wäre das ein separater, größerer Schritt mit Tiptap).

### Empfehlung an dich
- Für reine Link-Felder (z. B. "IMDb-URL"): weiterhin Feldtyp **URL** verwenden — sauber validiert.
- Für gemischte Texte (z. B. Notiz mit eingebetteter URL): profitiert automatisch von Auto-Linkify nach diesem Plan.

### Geänderte Dateien
- `src/lib/linkify.ts` (neu) — Helper.
- `src/pages/CollectionDetail.tsx` — `FieldValue` für `text`/`longtext` anpassen.
