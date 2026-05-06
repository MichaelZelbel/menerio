# Self-Erkennung: "Michael" = Nutzer (außer es spricht etwas dagegen)

## Problem

In Notizen schreibt der Nutzer über sich selbst in der dritten Person ("Michael's Main VRChat-Profil"). Aktuell:
- `process-note` sammelt Personen aus den Notizen und matched sie nur gegen `contacts` (Kontakte).
- Wenn ein Match nur den eigenen Vornamen liefert, wird trotzdem versucht, die Aussage einem Kontakt zuzuordnen — oder sie verschwindet im Nichts.
- Profil-Anreicherungen (`generateProfileSuggestions`) bekommen so nie den Hinweis "das war über mich".

## Lösungsidee: "Self-Alias" mit Disambiguierung

Wir behandeln den Nutzer wie eine spezielle Person mit konfigurierbaren Aliassen (Vorname, Spitzname, Initialen). Beim Person-Matching probieren wir zuerst **Self**, mit klar definierten Konflikt-Regeln, die ihn wieder ausschließen, wenn der Kontext eindeutig auf jemand anderen zeigt.

### 1. Profil: Self-Aliase pflegbar machen

Neue Profil-Kategorie `self_aliases` (oder Felder in `Identity & Basics`):
- `preferred_name` (z.B. "Michael")
- `aliases` (z.B. ["Mike", "M.H.", "@michael"])
- Toggle "Self-Matching aktiv" (Default: an)

UI: kleine Sektion auf `/dashboard/profile` mit Erklärung, warum das wichtig ist.

### 2. Matching-Heuristik in `process-note`

Vor dem normalen Contact-Matching pro extrahiertem Personennamen:

```text
1. Normalisiere Name (lowercase, trim, ohne Possessiv 's)
2. Wenn name ∈ self_aliases: Kandidat = SELF
3. Schaue, ob ein Kontakt existiert, der denselben Vornamen trägt
   (oder Alias-Match auf Kontakt-Aliase)
   → Konflikt-Liste C
4. Disambiguierung mit Signalen aus dem Notizfenster (±200 Zeichen
   um die Erwähnung):
   a. Voller Name eines Kontakts ("Michael Hellmich") → Kontakt gewinnt
   b. Beziehungswörter ("mein Bekannter", "Kollege", "Freund von mir",
      "traf X") → Kontakt
   c. 1.-Person-Marker rund um den Namen ("ich, Michael", "mein
      Profil", "meine", possessives 's auf eigenen Assets) → SELF
   d. Asset-/Profil-Kontext, der bereits in `profile_entries`
      vorkommt (z.B. der VRChat-Username steht im Profil) → SELF
   e. Sonst: Wenn nur SELF Kandidat ist → SELF.
      Wenn nur Kontakt(e) → Kontakt.
      Wenn beide möglich → "ambiguous": kein Auto-Link, stattdessen
      Eintrag in Review Queue (siehe 4).
```

Ergebnis pro erkannter Person eine von drei Kategorien:
`self` · `contact:<id>` · `ambiguous`.

### 3. Konsequenzen für die Pipeline

- **`metadata.matched_people`** bekommt zusätzlich `is_self: true` für Self-Treffer.
- **`generateProfileSuggestions`**: wenn `is_self`, fließt die Notiz direkt in Profil-Vorschläge des Nutzers (z.B. "VRChat Username gefunden: Add to Digital Life").
- **Wikilinks / Lexikon (`wiki-ingest`)**: Self-Treffer werden auf die existierende Person-Page des Nutzers (bzw. ein neues `[[me]]` / Profil-Slug) verlinkt, statt eine eigene `[[michael]]` Konzept-Seite zu erfinden.
- **People-Auto-Link**: Self-Treffer erzeugen keinen neuen Kontakt "Michael".

### 4. Review Queue für Ambiguitäten

Statt zu raten, legen wir bei `ambiguous` einen Review-Eintrag an:
- Titel: `"Michael" in "VRChat Sims-Profil" — du oder Michael Hellmich?`
- Aktionen: `Das bin ich` · `Das ist <Kontakt>` · `Anderer Michael` · `Ignorieren`
- Entscheidung wird in einer neuen `name_disambiguation_decisions` Tabelle gespeichert (Schlüssel: `user_id + lowercased_alias + context_signature`), damit ähnliche Fälle künftig automatisch korrekt entschieden werden.

### 5. Lernender Cache

Jeder bestätigte Match (manuell oder automatisch mit hoher Confidence) wird in derselben Tabelle protokolliert. Beim nächsten Notizen-Run wird bei gleichem Alias und vergleichbarem Kontext (z.B. selbe Folder/Tag) der frühere Entscheid bevorzugt.

## Technische Änderungen

- **DB-Migration**:
  - `profile_entries` erweitern um Kategorie `self_aliases` (oder neue Tabelle `user_self_aliases(user_id, alias, created_at)`).
  - Neue Tabelle `name_disambiguation_decisions(user_id, alias_lower, context_kind, target text /* 'self' | 'contact' */, target_contact_id uuid null, confidence numeric, last_seen_at timestamptz)`.
  - RLS: `user_id = auth.uid()` für alle Operationen.

- **Edge Function `process-note`**:
  - Vor dem Contact-Matching Self-Aliase laden (1× pro Run cachen).
  - Kontext-Fenster pro Erwähnung extrahieren, Heuristiken aus Schritt 2 anwenden.
  - `metadata.matched_people[i].is_self = true` setzen.
  - Bei `ambiguous`: Eintrag in Review Queue (vorhandene `review_queue` Mechanik) statt Auto-Link.
  - Lookup + Schreiben in `name_disambiguation_decisions`.

- **Edge Function `wiki-ingest`**:
  - Wenn `metadata.matched_people` ein Self-Treffer enthält und der Notizinhalt eine Self-Aussage ist, Profil-Page des Nutzers (`[[me]]`-Slug) als Quelle/Backlink verwenden.

- **Edge Function `generate-profile-suggestions`**:
  - Self-Treffer haben Priorität: konkrete Profil-Felder (Username, Handle, URL) als Suggestion erzeugen.

- **Frontend**:
  - `src/pages/Profile.tsx`: neue kleine Sektion "Wenn ich in Notizen über mich schreibe" mit Preferred Name + Aliassen.
  - `src/pages/ReviewQueue.tsx`: neue Item-Kategorie `name_disambiguation` mit den vier Aktionen.

## Wichtige Trade-offs

- Heuristik ist nie 100 %. Wir sind absichtlich konservativ: bei Konflikt **niemals automatisch SELF** wählen, sondern Review.
- Possessiv-`'s` und deutsche Genitive ("Michaels Profil") werden vor dem Match abgeschnitten.
- Wenn der Nutzer das Feature nicht mag, kann er Self-Matching im Profil komplett deaktivieren.

## Was diese Plan NICHT umfasst

- Vollständiger NLP-Coreference-Resolver. Wir verlassen uns auf einfache Regex/Window-Heuristiken plus den vorhandenen GPT-4o-mini-Schritt, falls das später noch zu unsicher bleibt.
- Auto-Migration alter Notizen — Backfill kann später per separatem Job laufen.
