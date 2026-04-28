Ich werde das Wiki nicht 1:1 kopieren, aber die aktuell formularartige Darstellung zu einer echten Wiki-Leseansicht umbauen.

## Zielbild

Die Wiki-Seiten bekommen eine dreispaltige, dokumentationsartige Struktur:

```text
Linke Wiki-Navigation     Lesbarer Artikel                  Rechte Sprungnavigation
- Overview                Titel + Summary                   On this page
- People                  Markdown-Artikel                  - Abschnitt 1
- Projects                Tabellen/Bilder/Links             - Abschnitt 2
- Topics                  Quellen/Backlinks kompakt         - Abschnitt 3
```

## Umsetzung

1. **Wiki-Seite als Artikel statt Karte/Formular**
   - Die große `Content`-Card wird entfernt bzw. nur noch im Edit-Modus genutzt.
   - Im normalen Lesemodus erscheint der Inhalt als breiter Artikel mit guter Typografie.
   - Titel, Summary, Page-Type und Updated/Sources bleiben sichtbar, aber zurückhaltender.

2. **Linke Wiki-Baum-Navigation**
   - Auf `/wiki/:slug` kommt links eine Navigation mit allen Wiki-Seiten, gruppiert nach `page_type`.
   - Aktuelle Seite wird hervorgehoben.
   - Die Struktur ersetzt das aktuelle Gefühl von einzelnen Kästen und wirkt mehr wie ein Wiki/Docs-System.
   - Auf kleineren Screens wird diese Navigation kompakter bzw. ausgeblendet, damit der Artikel lesbar bleibt.

3. **Rechte “On this page”-Navigation**
   - Aus Markdown-Überschriften (`#`, `##`, `###`) werden Abschnittsanker berechnet.
   - Rechts erscheint eine sticky “On this page”-Liste.
   - Klicks springen direkt zum jeweiligen Abschnitt im Artikel.
   - Der aktuell sichtbare Abschnitt wird visuell hervorgehoben.

4. **Bessere Lesbarkeit im Artikel**
   - Neue Wiki-Article-Stile für Absätze, Überschriften, Listen, Blockquotes, Code, Tabellen, Bilder und Links.
   - Mehr Abstand zwischen Absätzen und Abschnitten.
   - Tabellen bekommen klare Linien, Header-Hintergrund und horizontales Scrollen bei Bedarf.
   - Bilder werden mit Abstand, abgerundeten Ecken und Rahmen im Text platziert.
   - Links werden klar erkennbar: farbig, unterstrichen, mit Hover-State.
   - Wiki-Links bleiben intern und öffnen nicht in einem neuen Fenster.

5. **Backlinks und Sources weniger dominant**
   - Backlinks und Quellen bleiben erhalten, aber werden unter dem Artikel kompakter dargestellt.
   - Sie sollen wie Wiki-Metadaten wirken, nicht wie Hauptinhalt.

6. **Wiki-Startseite angleichen**
   - Die Startseite `/wiki` wird weniger kartig/formularartig.
   - Sie bekommt eine Wiki-Index-Ansicht mit gruppierten Seiten, Suchfeld und Recent Activity als Seitenbereich.
   - Das bleibt funktional ähnlich, sieht aber eher wie ein Wiki-Verzeichnis aus.

7. **Editor bleibt erhalten**
   - Der Edit-Modus nutzt weiterhin den bestehenden RichTextEditor und Toolbar.
   - Nur der normale Lesemodus wird stärker als gerenderter Wiki-Artikel gestaltet.

## Technische Details

- Änderungen hauptsächlich in:
  - `src/pages/WikiPage.tsx`
  - `src/pages/WikiHome.tsx`
  - `src/index.css`
- Für die Artikelansicht nutze ich weiterhin die vorhandene Markdown-zu-HTML/Tiptap-Pipeline, damit bestehende Inhalte, Tabellen, Bilder und Wiki-Links kompatibel bleiben.
- Ich ergänze Hilfsfunktionen zum Extrahieren von Überschriften und zum Erzeugen stabiler Anchor-IDs.
- Die rechten TOC-Links werden per `IntersectionObserver` aktiv markiert, ähnlich wie bereits in Docs/Legal-Seiten umgesetzt.
- Keine Datenbankänderung nötig.