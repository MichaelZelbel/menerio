# Plan: Jeder Graph-Knoten ist eine echte, klickbare Entität

## Ziel
Im Note Graph soll jeder sichtbare Knoten entweder
- eine **Note** (`/dashboard/notes/:id`) oder
- eine **Person** in People (`/dashboard/people/:contactId`)

sein. Keine synthetischen `person:<name>`-Knoten mehr, die ins Leere klicken.

## Ursache (heute)
`supabase/functions/get-graph-data/index.ts` → `pivotSharedPersonEdges`:
- Resolved Personen-Erwähnungen über `aliasMap` (exakter, lowercased Match auf `contacts.name` + `contacts.aliases`).
- Findet die Funktion **keinen** Kontakt, erzeugt sie einen Pivot-Knoten mit ID `person:<lowercased name>` und Titel = roher Mention-Name.
- Diese `person:`-Knoten sind nicht klickbar (kein Editor-Ziel, keine People-Seite).
- Beispiel: "Nate Jones" / "Karpathy" existieren als Kontakt oder Alias, werden aber wegen Whitespace/Capitalization/Schreibweise nicht gematcht.

## Lösung

### 1. Stärkere Personen-Auflösung in `get-graph-data`
Neue Resolver-Reihenfolge pro Mention-String:
1. Exakter Alias-Match (wie heute).
2. **Normalisierter** Match: Whitespace zusammenziehen, Diakritika strippen, Punkte/Bindestriche entfernen, lowercase. Kontakte einmal pro Request normalisieren und in einer zweiten Map cachen.
3. **Fuzzy-Match** über Levenshtein ≤ 2 gegen Kontakt-Namen + Aliase, gemäß bestehender People-Identity-Konvention (siehe `mem://features/people-identity`). Nur eindeutige Treffer akzeptieren (genau 1 Kandidat mit Distanz ≤ 2); sonst gilt der Match als ambig.
4. **Note-Title-Match**: wenn eine eigene Note exakt/normalisiert den Mention-Namen als Titel hat (z. B. eine Profilnotiz "Nate Jones"), pivot auf diese Note (bestehender `profileNoteByContact`-Pfad ausweiten auf alle Notes, nicht nur Kontakt-Profile).

### 2. Fallback statt synthetischem Knoten
Wenn keiner der Resolver greift:
- **Kein** `person:<name>`-Knoten mehr erzeugen.
- Stattdessen die ursprüngliche `shared_person`-Verbindung als **direkte Note↔Note-Edge** beibehalten (Edge-Type `shared_person`, wie er aus der DB kommt). Der Graph verliert dadurch nichts an Information; nur das Pivot-Detail entfällt für unbekannte Personen.
- Bestehende Render-Logik für `shared_person` ist bereits da (vor dem Pivot war das der Default).

### 3. Klick-Verhalten klarstellen
In `src/pages/KnowledgeGraph.tsx` `handleNodeClick`:
- Person-Knoten (Pivot via Kontakt) → `/dashboard/people/:contactId`.
- Profil-Note als Pivot → `/dashboard/notes/:noteId`.
- Note-Knoten → `/dashboard/notes/:noteId`.
- Defensive Guard: Knoten mit ID-Präfix `person:` oder `contact:<uuid>` ohne tatsächlichen Kontakt werden gar nicht mehr erzeugt; falls doch (Edge Case), werden sie übersprungen.

### 4. Tests / Verifikation
- Manuell mit dem aktuellen Vault: prüfen, dass Knoten "natejones" und "karpathy" entweder als Kontakt-Knoten (klickbar nach People) auftauchen oder verschwinden zugunsten von Note↔Note-Edges.
- `console.log` temporär in `pivotSharedPersonEdges` für unresolved Mentions, dann entfernen.

## Technische Details

Geänderte Dateien:
- `supabase/functions/get-graph-data/index.ts`
  - Neue Helper `buildNormalizedAliasMap(contacts)` + `resolvePersonToContactId(name, maps, contacts)`.
  - `ensurePersonNode` entfällt für den unresolved-Fall; gibt `null` zurück → Caller emittiert stattdessen die direkte Note↔Note-Edge.
- `src/pages/KnowledgeGraph.tsx`
  - `handleNodeClick`: explizit Routing für `contact:<uuid>` → People-Profil.
  - Hover/Selection-State: Pivot-Person zeigt im Side-Panel Liste der referenzierenden Notes.
- (optional) `src/components/graph/graphRendering.ts`: keine Änderung nötig, da Person-Knoten weiterhin Tier 0 bleiben.

Bewusst **nicht** dabei:
- Auto-Anlage von Kontakten aus unbekannten Mentions (gehört in Review Queue, ist separater Flow).
- Änderungen an `recompute-all-connections` oder anderen Pipelines — die DB-Edges bleiben wie sie sind, nur die Render-Pivot-Logik wird strenger.

## Risiken
- Fuzzy-Match kann falsch-positiv mergen (z. B. zwei verschiedene "Chris"). Mitigation: nur bei Distanz ≤ 2 **und** genau einem Kandidaten.
- Bei sehr vielen Mentions wird die direkte Note↔Note-Kante als Fallback wieder häufiger sichtbar → leichte Zunahme der Edge-Dichte. Akzeptabel, weil Edge-LOD bei niedrigem Zoom bereits ausfiltert.
