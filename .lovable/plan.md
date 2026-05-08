# Bessere Personenerkennung in Notizen

## Was im Screenshot schiefläuft

Beim Verarbeiten einer Notiz mit „Shi Hui" (deine Frau, schon als Kontakt vorhanden) und „George Clooney" (Schauspieler, kein Kontakt) landen unnötig viele Einträge im Review Queue:

- „Michael" wird als „bist du das?" gefragt — obwohl Michael dein Kontoname ist und keine eindeutige andere Person im Kontext steht.
- „Xihui" wird als „bist du das?" gefragt — obwohl es einen Kontakt mit genau diesem Namen gibt.
- „George Clooney" bekommt **zwei** Einträge: einmal „Add to People", einmal „bist du das?".

Beim Lesen von `supabase/functions/process-note/index.ts` (`disambiguateMention`, Zeilen ~155–192, plus Auto-Link-Block ~1164–1260) habe ich drei klare Fehlentscheidungen gefunden, die wir gezielt drehen können — kein neuer LLM-Call nötig.

## Bug 1 — Unbekannte Namen werden fälschlich als „bist du das?" markiert

In `disambiguateMention`:

```ts
const isSelfAlias = self.enabled && nameMatchesAlias(person, self.aliases);
if (!isSelfAlias) {
  return { kind: contactCandidates.length > 0 ? "contact" : "ambiguous", ... };
}
```

Wenn der Name **kein** Self-Alias ist und es **keinen** Kontaktkandidaten gibt, wird `ambiguous` zurückgegeben → der Auto-Link-Block schreibt einen `name_disambiguation`-Eintrag „is this you or another person?". Das ist die Ursache für den George-Clooney-Eintrag.

**Fix:** In dem Zweig `kind: "skip"` zurückgeben (oder einfach gar nicht in `ambiguousMentions` aufnehmen). „Bist du das?" darf nur entstehen, wenn der Name tatsächlich einem Self-Alias ähnelt.

## Bug 2 — Bekannte Kontakte schlagen Self-Alias zu schwach

Wenn „Xihui" sowohl auf einen Kontakt **als auch** auf einen Self-Alias matcht (z. B. weil der User früher mal etwas bestätigt hat oder weil der Vorname des Users zufällig ähnlich klingt), entscheidet der Kontextfenster-Heuristik. Aktuell:

1. Voller Kontaktname im Kontextfenster → Kontakt gewinnt.
2. Sonst: Self-Marker („my", „mein") → Self.
3. Sonst: ambiguous.

Das Problem: Schon ein einzelner Kontakt mit **identischem Namen** wie der Mention sollte stark genug sein. „my wife Xihui" enthält außerdem das Self-Token „my", das dann fälschlich Self auslöst.

**Fix:**
- Wenn ein Kontakt **exakt** denselben Namen trägt wie die Mention (`nameToContact.get(person.toLowerCase())` greift) → Kontakt gewinnt direkt, Self-Check wird übersprungen.
- `OTHER_MARKERS` um Beziehungsbegriffe erweitern: „my wife/husband/partner/boyfriend/girlfriend/mom/dad/son/daughter", „meine Frau/mein Mann/meine Partnerin/mein Partner/meine Tochter/mein Sohn/meine Mutter/mein Vater" usw. Diese stehen **vor** dem Self-Marker-Check und kippen die Entscheidung sicher auf „contact".

## Bug 3 — „Michael" (= du selbst) sollte nicht ständig erfragt werden

Wenn die Mention exakt deinem `preferredName` / Display-Name entspricht und **kein** Kontakt mit demselben vollen Namen im Kontextfenster steht, ist die Wahrscheinlichkeit für „Self" sehr hoch.

**Fix:** Wenn `person.toLowerCase() === selfCtx.preferredName?.toLowerCase()` und keine Kontaktkandidaten vorhanden sind, direkt `self` annehmen (ohne Review-Eintrag). Falls ein Kontakt denselben Namen trägt, einmalig einen `name_disambiguation`-Eintrag erzeugen — aber sobald der User entscheidet, merkt sich `recordDisambiguation` das (existiert bereits) und fragt nicht erneut.

## Bug 4 — Doppelte Einträge für dieselbe Person

George Clooney bekommt „Add to People" **und** „is this you?". Selbst nach Fix 1 sollten wir defensiv eine Deduplizierung einziehen:

**Fix:** Vor dem Insert in `review_queue` die `suppression_key`s pro Notiz/Person zusammenführen — wenn ein `add_contact` für „George Clooney" entsteht, kein `name_disambiguation` für denselben Namen einfügen.

## Optionale Folge-Verbesserung (separat, wenn gewünscht)

Für richtig knifflige Fälle könnten wir später einen kleinen LLM-Pass über die wirklich verbleibenden ambiguen Mentions schicken (mit `gpt-5-nano` oder `gemini-3-flash`, batched pro Notiz, Tool-Calling für strukturierte Antwort). Das kostet aber Credits — lieber erst die Heuristik fixen und schauen, wie viele Fälle übrigbleiben.

---

## Technische Zusammenfassung

Datei: `supabase/functions/process-note/index.ts`

1. `disambiguateMention` (Z. 157–192):
   - Reihenfolge umstellen: **erst** auf exakten Kontakt-Namensmatch prüfen → `contact`.
   - **Erst danach** `isSelfAlias` prüfen; wenn `false` und keine Kandidaten → neue Variante `kind: "skip"` (statt `ambiguous`).
   - `OTHER_MARKERS` um Verwandtschafts-/Beziehungsbegriffe (DE + EN) erweitern und vor `SELF_MARKERS` evaluieren.
   - Self-Match nur dann automatisch akzeptieren, wenn Mention exakt dem `preferredName` entspricht und keine Kandidaten existieren.

2. Auto-Link-Block (Z. 1164–1260):
   - `SelfDecision` um `"skip"` erweitern; `skip` weder in `matchedPeople` noch in `ambiguousMentions` aufnehmen.
   - Vor dem `review_queue`-Insert für `name_disambiguation` filtern: alle Mentions ausschließen, für die im selben Lauf bereits ein `add_contact` erzeugt wurde.

3. Keine Schema- oder DB-Änderungen nötig; `name_disambiguation_decisions` und `recordDisambiguation` bleiben unverändert.

---

Sag mir, ob ich das so umsetzen soll, oder ob du erst noch z. B. den optionalen LLM-Pass mit reinnehmen willst.