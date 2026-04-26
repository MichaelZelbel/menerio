Du hast recht: Das ist kein technischer Grund und keine bewusste Weigerung. Der Fehler ist, dass ich den Prototyp-Font nicht zuverlässig aus der Quelle übernommen habe, sondern wieder eine sichtbare Approximation eingebaut habe. Zusätzlich kann der Unterschied durch bestehende globale Heading-Regeln und ggf. Browser-/Cache-Verhalten so wirken, als hätte sich nichts geändert.

Plan zur Korrektur:

1. Den aktuellen falschen/ungenauen Headline-Font entfernen
   - `Baloo 2` wird für die Landing-Page-Headlines nicht weiter als Ersatz verwendet.
   - Die Variable `--font-hero` wird auf den tatsächlichen Prototyp-Font umgestellt, nicht auf eine ähnliche Schrift.

2. Den Prototyp-Font robust einbinden
   - Wenn der Font ein Google Font ist: exakten Fontnamen und benötigte Gewichte importieren.
   - Wenn der Prototyp eine eingebettete/Custom-Schrift nutzt: diese als Webfont in das Projekt übernehmen und per `@font-face` laden.
   - Wichtig: Keine Fallback-Schrift als primäre Lösung. Der erste Font in `font-family` muss der Prototyp-Font sein.

3. Landing-Page-Headlines hart auf diesen Font setzen
   - Hero-H1: `One Brain. Every AI.`
   - Section-H2: `Your thoughts, supercharged by AI`
   - CTA-H2: `Ready to build your brain?`
   - Optional auch der Menerio-Schriftzug im Header/Footer, falls dieser ebenfalls laut Prototyp stilisiert sein soll.

4. Globale Heading-Regeln nicht mehr dazwischenfunken lassen
   - Die Landing-Page-Headline-Klassen bekommen explizit `font-family`, `font-weight`, `line-height`, `letter-spacing` und ggf. `font-synthesis: none`.
   - Damit überschreibt `h1, h2, h3 { font-family: var(--font-display) }` die Landing-Page nicht mehr visuell.

5. Sichtbarkeit der Änderung sicherstellen
   - Nach der Änderung TypeScript prüfen.
   - Zusätzlich eine kurze Sichtprüfung im Preview bei der aktuellen Breite machen, damit wir nicht nur Code ändern, sondern sehen, ob sich die Headline wirklich sichtbar vom alten Zustand unterscheidet.

Technischer Hinweis:
- Die aktuell referenzierte Claude-Preview-URL liefert inzwischen teils `invalid preview token`/403, daher ist sie als Quelle nicht mehr zuverlässig abrufbar. Ich werde deshalb den bereits aus dem Prototyp bekannten Look gezielt durch den exakten verwendeten Display-Font bzw. die Projekt-/Design-Quelle nachziehen. Falls der Prototyp-Font eine proprietäre Datei war und nicht im Projekt vorhanden ist, brauche ich die Font-Datei oder einen neuen gültigen Prototyp-Link; andernfalls nutze ich den exakten öffentlich verfügbaren Font.