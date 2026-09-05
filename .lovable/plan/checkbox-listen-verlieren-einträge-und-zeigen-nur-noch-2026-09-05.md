# Checkbox-Listen verlieren Einträge und zeigen nur noch „[ ]“

## Der Bug ist reproduzierbar

Ich habe den Notiz-Konverter direkt getestet. Drei zusammenhängende Fehler:

1. **Leeres Kästchen zerstört die Liste.** Eine Zeile mit einem noch leeren Kästchen (`- [ ]` ohne Text dahinter) wird nicht mehr als Kästchen erkannt, sondern als normaler Aufzählungspunkt mit dem sichtbaren Text `[ ]` — genau das, was du siehst.
2. **Alles darunter verschwindet.** Sobald so eine Zeile auftaucht, bricht die Verarbeitung der restlichen Liste ab. Im Test wurde aus zwei Punkten nur noch ein einziger `[ ]`-Punkt; der zweite Eintrag war komplett weg. Da die Notiz danach automatisch gespeichert wird, geht der Inhalt wirklich verloren.
3. **Der `--`-Trenner ist der Auslöser.** Steht `--` direkt über der Liste (ohne Leerzeile), wird der Trenner samt aller Zeilen darüber beim Öffnen der Notiz stillschweigend verschluckt. Steht er darunter, wird er in den letzten Listenpunkt hineingezogen. Deshalb fällt dir das Problem vor allem bei Listen unter `--` auf.

Test-Beleg (Eingabe → Ergebnis):
```text
"--\n\n- [ ]\n- [ ] b"   →   "--"  +  Aufzählung mit einem Punkt "[ ]"   (Punkt "b" fehlt)
"Intro\n--\n- [ ] a"     →   nur die Liste; "Intro" und "--" fehlen
```

## Was ich ändern werde

Alle Änderungen liegen in der Umwandlung zwischen Notiztext und Editor-Darstellung.

- **Leere Kästchen bleiben Kästchen.** `- [ ]` und `- [x]` ohne nachfolgenden Text werden als leerer Aufgaben-Eintrag erkannt statt als Text `[ ]`.
- **Keine abgeschnittenen Listen mehr.** Wechselt der Listentyp mitten in einem Abschnitt, werden die restlichen Zeilen als weitere Liste ausgegeben, statt sie wegzuwerfen. Nichts wird stillschweigend verworfen.
- **Text und Trenner über einer Liste bleiben erhalten.** Zeilen, die vor dem ersten Listenpunkt stehen, werden als eigener Absatz ausgegeben; `--` bleibt sichtbar.
- **`--` unter einer Liste** wird nicht mehr in den letzten Listenpunkt hineingezogen, sondern als eigene Zeile behandelt.
- **Beim Speichern** wird ein leerer Aufgaben-Eintrag ohne störendes Leerzeichen am Zeilenende geschrieben, damit er beim nächsten Öffnen sicher wieder als Kästchen erkannt wird.

## Technische Details

- `src/utils/markdown-converter.ts`
  - `markdownListToHtml`: Zeilen-Regex auf `(- \[([ xX])\](?:\s+|$))` erweitern; `render()` in einer Schleife über alle Zeilen aufrufen, sodass Geschwisterlisten nach einem Typwechsel weiter gerendert werden; Vorspann-Zeilen vor dem ersten Listen-Match als Absatz voranstellen statt zu verwerfen; die Continuation-Logik nur greifen lassen, wenn die Zeile eingerückt ist (nicht bei `--` auf Spaltenposition 0).
  - `serializeTaskItem`: leeres Item als `- [ ]` ohne Trailing-Space serialisieren.
- Neue Tests in `src/utils/__tests__/markdown-converter.test.ts`: leeres Kästchen, Liste nach `--`, Text vor Liste im selben Block, Round-Trip Markdown → HTML → Markdown ohne Verlust.
- Kein Backend-, Datenbank- oder Editor-Verhalten außerhalb dieser Umwandlung wird angefasst.

## Bestehende Notizen

Der Fehler zerstört Inhalte erst beim erneuten Speichern. Notizen, in denen bereits `[ ]` als Text steht, kann ich nach dem Fix auf Wunsch in einem separaten Durchlauf zurück in echte Kästchen umwandeln — sag Bescheid, ob du das möchtest.
