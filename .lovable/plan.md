Ich würde den Dark Mode als neuen Standard für Menerio setzen.

Umsetzung:
1. Theme-Provider anpassen
   - In `src/App.tsx` steht aktuell `defaultTheme="system"`.
   - Das bedeutet: Neue Nutzer bekommen derzeit das Betriebssystem-/Browser-Theme. Wenn ihr System hell ist, startet Menerio im Light Mode.
   - Ich ändere das auf `defaultTheme="dark"`, sodass neue Nutzer standardmäßig Dark Mode sehen.

2. Light Mode weiterhin optional lassen
   - Der bestehende Theme Toggle bleibt unverändert.
   - Nutzer können weiterhin manuell auf Light Mode wechseln.
   - Diese Auswahl wird von `next-themes` wie bisher gespeichert, sodass bestehende Nutzer mit gespeicherter Präferenz nicht plötzlich überschrieben werden.

3. Optionaler Feinschliff
   - Falls nötig, setze ich zusätzlich `enableSystem={false}`, damit „System Theme“ nicht mehr als impliziter Default wirkt.
   - Empfehlung: `defaultTheme="dark"` reicht in der Regel aus und ist am wenigsten invasiv.

Technische Details:
```tsx
<ThemeProvider
  attribute="class"
  defaultTheme="dark"
  enableSystem
  disableTransitionOnChange={false}
>
```

Ergebnis:
- Neue Besucher und neue Accounts starten in Dark Mode.
- Light Mode bleibt über den bestehenden Toggle verfügbar.
- Gespeicherte Theme-Präferenzen bestehender Nutzer bleiben erhalten.