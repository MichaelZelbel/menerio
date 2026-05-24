## Problem

Im freien Texteingabefeld des `SmartDatePicker` setzt sich beim Tippen zweistelliger Tage (z. B. 11, 12, 15, 20) automatisch eine `0` vor die Eingabe — der Wert lässt sich nicht mehr sauber überschreiben.

## Ursache

Datei: `src/components/ui/smart-date-picker.tsx`

Der Auslöser ist eine Rückkopplung zwischen `handleTextChange` und dem `useEffect`, der `text` aus `value` neu formatiert:

Beispiel: Feld zeigt `2024-01-05`, Nutzer will auf `15` ändern.
1. Nutzer löscht die `5` → Text = `2024-01-0` → parst nicht.
2. Nutzer tippt `1` → Text = `2024-01-01` → parst erfolgreich als 1. Januar.
3. `handleTextChange` ruft `onChange(parsed)` auf → Parent aktualisiert `value`.
4. `useEffect` sieht `value !== lastValueRef.current` und ruft `setText(format(value, "yyyy-MM-dd"))` auf → Text wird zu `2024-01-01` **inklusive führender Null** zurückgesetzt, obwohl der Nutzer gerade noch tippt.
5. Nutzer tippt `5` → Text = `2024-01-015` → ungültig (roter Rand). Die `0` lässt sich nicht entfernen, weil sie bei jeder validen Zwischeneingabe sofort wieder reingeschrieben wird.

Bei Tagen 01–09 fällt es nicht auf, weil die führende Null dort sowieso korrekt ist.

## Lösung

Zwei kleine Änderungen in `src/components/ui/smart-date-picker.tsx`:

1. **In `handleTextChange`:** vor dem `onChange(parsed)`-Call die Ref aktualisieren: `lastValueRef.current = parsed`. Damit erkennt der `useEffect` die Änderung als selbst verursacht und überschreibt das Textfeld nicht mehr.
2. **Im Sync-`useEffect`:** zusätzlich ein Fokus-Guard — wenn das Eingabefeld gerade fokussiert ist (`document.activeElement === inputRef.current`), den Text nicht überschreiben. Dafür eine `inputRef` ans `<Input>` hängen. So bleibt die Nutzereingabe auch bei externen Value-Änderungen unangetastet, solange getippt wird.

Beim Verlassen des Feldes (`onBlur`) bleibt das Verhalten korrekt: wenn der aktuelle Text gültig parst, wird er in Normalform (`yyyy-MM-dd`) zurückformatiert; wenn nicht, bleibt der invalid-state sichtbar.

## Keine Änderungen

- Parser-Formate, Kalender, Monat/Jahr-Dropdowns, Popover-Verhalten bleiben unverändert.
- Keine Integrationen außerhalb dieser Datei.
