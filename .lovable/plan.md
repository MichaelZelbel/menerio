## Was wirklich schiefläuft

Der Vorschlag in der Review Queue (`review_queue` Zeile gefunden) sieht so aus:

```
title:    "Add to Gunther Reinhard's profile: Birthday"
payload:  { category_slug: "identity", label: "Birthday",
            value: "61st birthday on 2026-05-25", category_id: null }
status:   "kept"
target_entity_id: null
applied_at:       null
```

In `profile_entries` für Gunther Reinhard: **null Zeilen** — obwohl drei Einträge (Birthday, Reporting manager, Job title) auf „kept" stehen. Es gibt also zwei voneinander unabhängige Bugs:

### Bug 1 — „Keep" schreibt nichts ins Profil

In `src/pages/ReviewQueue.tsx`:

- `handleKeep` ruft `handleAccept` nur auf, wenn `item.status === "pending" | "pending_review"`. Für alles andere (`auto_applied_unreviewed`, oder wenn das Item schon einmal angefasst wurde) wird nur `status = "kept"` gesetzt, **ohne** in `profile_entries` einzutragen.
- `handleKeepAll` ist noch radikaler: es macht ausschließlich `updateStatus.mutate({status: "kept"})` für jedes Item und ruft `handleAccept` gar nie auf. Genau das hat hier zugeschlagen — drei kept-Items, alle ohne `target_entity_id`, alle ohne entsprechenden DB-Eintrag.

Dass die UI dann „Change kept" als Erfolgsmeldung zeigt, ist die Fehlinformation, die du beschrieben hast.

### Bug 2 — Die AI rechnet das Geburtsdatum nicht aus

Im `PROFILE_EXTRACTION_PROMPT` in `supabase/functions/process-note/index.ts` steht nichts dazu, aus „Alter + Bezugsdatum" das eigentliche Geburtsdatum abzuleiten. Das LLM speichert die Aussage roh als `value: "61st birthday on 2026-05-25"` — semantisch sinnlos für ein Profilfeld, das man später wiederverwenden will (Erinnerungen, Lexicon, MCP).

Außerdem nutzt das Label `"Birthday"`, das schon in `SINGLETON_PROFILE_LABELS` steht, aber nicht der projektübliche Begriff `"Date of birth"` ist (existierender Eintrag in deiner DB heißt schon „Date of birth"). Dadurch entstehen zwei konkurrierende Felder.

---

## Plan

### 1. Review Queue: „Keep" muss immer das anwenden, was es verspricht

Datei: `src/pages/ReviewQueue.tsx`

- `handleKeep`: Für jeden Status, der noch nicht angewendet wurde (`pending`, `pending_review`, `auto_applied_unreviewed` ohne `target_entity_id`), `handleAccept(item)` aufrufen. Nur wenn das Item nachweislich schon angewendet wurde (`target_entity_id` gesetzt **und** `applied_at` gesetzt), reicht der reine Status-Flip.
- `handleKeepAll`: Statt blindem `updateStatus.mutate` für jedes Item `await handleAccept(item)` sequenziell oder mit `Promise.allSettled` ausführen, damit die jeweiligen Einfüge-Pfade laufen (Profile-Entry, Relationship, Group-Member, …). Fehler einzeln per Toast melden, statt „All visible changes kept" zu lügen.
- `handleAcceptProfileEntry`: Nach erfolgreichem Insert die `review_queue`-Zeile mit `target_entity_id` und `applied_at` aktualisieren (via `extra`-Param der `updateStatus`-Mutation). Dann kann „Roll Back" / Audit wirklich funktionieren.
- Bestehende kept-Items mit `target_entity_id IS NULL` einmalig „heilen": Beim Öffnen der Queue erkennt der UI-Code solche „verwaisten Kept" als nicht angewendet und bietet einen „Apply now"-Button (kein Magie-Auto-Apply, damit nicht ungewollt sensible Daten reinrutschen).

### 2. AI lernt, Geburtsdaten und ähnliche Fakten zu errechnen

Datei: `supabase/functions/process-note/index.ts`

a) **Prompt-Erweiterung** im `PROFILE_EXTRACTION_PROMPT`:
   - Neuer Abschnitt „Derived facts — when the note gives you age + reference date, compute the underlying canonical fact":
     - Geburtstag: „X turned N on YYYY-MM-DD" / „N. Geburtstag am …" → `label: "Date of birth"`, `value: "YYYY-05-25"` (Jahr = Bezugsjahr − N, Monat/Tag vom Bezugsdatum).
     - Hochzeitstag analog (Anniversary).
     - Berufsdauer: „X arbeitet seit 10 Jahren bei Y" + Note-Datum → `Start at company: YYYY`.
   - Regel: Nur ableiten, wenn Bezugsdatum **explizit** im Text steht oder unzweifelhaft aus dem Note-Kontext (`created_at` der Note wird zusätzlich in den User-Prompt gehängt) hervorgeht.
   - Format-Vorgabe: Datumswerte immer als ISO `YYYY-MM-DD`; Labels in einer kleinen kanonischen Liste (Date of birth, Anniversary, Start at company, …) statt freier Strings.
   - 2–3 konkrete Few-Shot-Beispiele inkl. des Gunther-Falls (anonymisiert).

b) **Deterministischer Sanity-Pass** nach dem LLM-Parse (Defense in depth):
   - Wenn `label` zu `birthday|date of birth|dob|geburtstag` matcht und `value` ein Muster `"<N>(st|nd|rd|th)? birthday on YYYY-MM-DD"` / `"turned N on YYYY-MM-DD"` / `"wurde N am YYYY-MM-DD"` enthält, in `{label: "Date of birth", value: "YYYY-MM-DD"}` umschreiben (Jahr = Bezugsjahr − N).
   - Wenn `label = "Birthday"` und `value` bereits ein ISO-Datum ist, Label kanonisch auf `Date of birth` setzen.
   - Bezugsdatum aus dem Text via Regex, sonst Fallback auf Note-`created_at`.

c) `SINGLETON_PROFILE_LABELS` ergänzen, damit `date of birth` und `birthday` als eine logische Spalte gelten — also keine doppelten Vorschläge mehr.

d) Note-Date in den User-Prompt aufnehmen (`Note date: YYYY-MM-DD`), damit das LLM für relative Aussagen („letzten Montag") ankoppeln kann. Note-`created_at` ist bereits verfügbar im Aufrufer.

### 3. Saubere Anzeige im People-Profil

Nach erfolgreichem Insert in `handleAcceptProfileEntry` werden bereits `["contact-profile-entries", "contact-profile-categories"]` invalidiert. Zusätzlich:

- Im Success-Toast einen „View profile"-Link auf `/dashboard/people/<contact_id>` rendern, damit man sieht, dass es wirklich gelandet ist.
- Im Profil-Rendering (`src/components/people/ContactProfileTab.tsx`) sicherstellen, dass `Identity & Basics` Einträge mit Label „Date of birth" ein ISO-Datum hübsch formatieren (z. B. „25 May 1965"). Nur Anzeigeschicht, keine Logikänderung.

### 4. Verifikation

- Migration nicht nötig (rein Code).
- Manuell prüfen: erneut Notiz „Günther hatte am Montag, 25.05.2026 seinen 61. Geburtstag" verarbeiten → Review-Queue-Eintrag muss zeigen `Date of birth: 1965-05-25`. „Keep" → Eintrag erscheint im Profil unter Identity & Basics.
- Für die drei bereits „kept" Items in deiner DB: einmalig manuell „Apply now" anbieten, oder ich räume sie per Mini-Skript auf, falls du das lieber hättest (`status: "pending_review"`, `payload.value` für Birthday umrechnen) — sag kurz Bescheid.

---

## Geänderte Dateien (geplant)

- `supabase/functions/process-note/index.ts` — Prompt, Sanity-Pass, Singleton-Set, Note-Date im Prompt
- `src/pages/ReviewQueue.tsx` — `handleKeep`, `handleKeepAll`, `handleAcceptProfileEntry` (target_entity_id zurückschreiben), „Apply now" für verwaiste kept-Items
- `src/components/people/ContactProfileTab.tsx` — Datums-Formatierung für „Date of birth"
