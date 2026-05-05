# Verschwindender Text beim Speichern — Diagnose & Fix

## Symptom
Texte wie `/plugin install skill-creator@claude-plugins-official` lassen sich eingeben, verschwinden aber, sobald man die Notiz verlässt (= nach Autosave + Reload).

## Hypothese (Reihenfolge der Wahrscheinlichkeit)

1. **Markdown-Roundtrip-Verlust (sehr wahrscheinlich)**
   `tiptapJsonToMarkdown` → DB → `markdownToHtml` beim Reload. In `markdownToHtml` werden Zeilen, die mit `- `, `* `, `+ ` oder `\d+. ` beginnen, als Listen behandelt. Eine Zeile, die mit **`/`** beginnt, ist unkritisch — aber `escapeMarkdownText` und `inlineMarkdown` haben mehrere Regex-Pässe, die mit `@`, `[`, `]`, `*` interagieren. Konkret prüfen:
   - `escapeMarkdownText` macht `text.replace(/\\([#*_[\]()`])/g, "$1")` — entfernt Escapes statt sie zu setzen.
   - Beim Serialisieren werden Zeichen wie `*`, `_`, `[`, `]` **nicht** escaped → ein roher String wie `skill-creator@claude-plugins-official` ist safe, aber `*`-haltige oder `[…]`-haltige Texte könnten beim Re-Parse als Bold/Link interpretiert werden.

2. **`onUpdate`-Skip-Regel verwirft den Save**
   ```ts
   if (!e.isFocused && countMarkdownLinks(note.content) > countMarkdownLinks(md)) return;
   ```
   `countMarkdownLinks` matcht `https?:\/\/\S+`. Wenn die alte Notiz mehr URL-ähnliche Strings enthielt als die neue, wird der Save *stillschweigend verworfen* (nur ein `console.warn`). Das könnte erklären, warum Änderungen einfach „weg" sind.

3. **`tiptap-markdown` Markdown-Extension parst `/befehl` oder `@mention` als Sonder-Token**
   Mit `transformPastedText: true` werden eingefügte Texte durch den Markdown-Parser geschickt. Beim Tippen normalerweise nicht — aber wenn die Zeile beim Autosave wieder durch `getJSON → tiptapJsonToMarkdown` und beim nächsten Mount durch `markdownToHtml` läuft, kann sich was verlieren.

4. **WikilinkResolver greift nicht** — early-return bei fehlendem `[[`. Sehr unwahrscheinlich Ursache. ✗

## Diagnose-Schritte (vor Fix!)

1. **DB-Inhalt prüfen** für die betroffene Notiz `1cbbd31f-4238-41a9-be75-ab17bd464567`:
   ```sql
   select length(content), content from notes
   where id = '1cbbd31f-4238-41a9-be75-ab17bd464567';
   ```
   → Steht der String tatsächlich in der DB oder nicht? Damit grenzen wir auf „Save-Verlust" vs. „Render-Verlust" ein.

2. **Console-Logs lesen** während Reproduktion: tritt `"Skipped non-user editor update that would remove links"` auf?

3. **Roundtrip-Test schreiben** in `src/utils/__tests__/markdown-converter.test.ts`: Input `/plugin install skill-creator@claude-plugins-official` → `markdownToHtml` → simulierte Tiptap-JSON → `tiptapJsonToMarkdown` → muss bit-genau gleich zurückkommen.

## Fix-Plan (abhängig von Diagnose, aber alle additiv)

### A. Skip-Regel entschärfen
`onUpdate` darf Saves **nicht stillschweigend verwerfen**. Entweder:
- Regel komplett entfernen (sie war ein Workaround gegen ein anderes Problem), oder
- nur skippen, wenn das Verhältnis dramatisch ist UND der User wirklich nicht fokussiert ist (z.B. Notenwechsel), und in jedem Fall **toasten** statt nur loggen.

### B. Roundtrip härten in `markdownToHtml` / `tiptapJsonToMarkdown`
- `escapeMarkdownText` umbenennen + invertieren: aktuell *entfernt* es Escapes (Name lügt). Stattdessen Sonderzeichen wie `*`, `_`, `[`, `]`, `\`` in Text-Knoten beim Serialisieren mit Backslash escapen, damit Re-Parse sie nicht als Markup interpretiert.
- `markdownToHtml`: Zeilen die mit `/` oder anderen Slash-Befehlen beginnen, sind eh Plain-Text — keine Sonderbehandlung. Aber prüfen, dass `@xxx` nicht als Mention/Autolink gefressen wird (sollte nicht, aber Test absichern).

### C. Tests
- Neuer Roundtrip-Test mit den problematischen Strings:
  - `/plugin install skill-creator@claude-plugins-official`
  - `npm install @scope/package-name@1.2.3`
  - `https://example.com/path?x=1&y=2`
  - Strings mit `*`, `_`, `[`, `]` mitten im Wort

### D. Wikilink-Resolver lassen wie er ist
Der Resolver hat einen sicheren early-return; er ist nicht das Problem. Keine Änderung dort.

## Out of scope
- Editor-Refactor (z.B. weg von tiptap-markdown). Erstmal die zwei konkreten Lecks abdichten.

## Reihenfolge der Umsetzung
1. DB-Read der konkreten Notiz (sofort, klärt Hypothese in 30s).
2. Konsolen-Logs lesen.
3. Je nach Befund: A (Skip-Regel) und/oder B (Escape) implementieren.
4. Tests in `markdown-converter.test.ts` ergänzen.
5. Manuelle Verifikation in der betroffenen Notiz.

Soll ich genau so vorgehen?
