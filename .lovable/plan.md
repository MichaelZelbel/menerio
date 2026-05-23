
## Ziel

Pro Datenobjekt entscheiden können: „Darf ein MCP-Server (ChatGPT, Claude usw.) dieses Objekt sehen?" Standardmäßig sichtbar, aber mit einem einfachen Schalter zum Verstecken — plus einer „Sensitive"-Markierung auf einer Person, die automatisch auf alle verknüpften Objekte abfärbt.

## UX-Konzept

Drei Ebenen, kombinierbar, mit klarem Vorrang **Sensitiv > Versteckt > Sichtbar**:

**1. Per-Objekt Toggle („Visible to AI / Hidden from AI")**
- Kleines Augen-Icon im Header von Note-, Person-, Moment-, Collection-Item- und Action-Item-Detail-Views.
- Zwei States: `eye` (sichtbar, default) / `eye-off` mit dezentem Badge „Hidden from AI" (versteckt).
- Tooltip erklärt: „MCP-Server (ChatGPT, Claude, …) sehen dieses Objekt nicht. In Menerio bleibt es normal nutzbar."
- Bulk-Action in Listen: mehrere auswählen → „Hide from AI" / „Show to AI".

**2. Person-Level „Sensitive"-Schalter**
- In der People-Detail-Ansicht ein Schalter „Treat as sensitive". Wenn an:
  - Die Person selbst (Name + Beziehung bleibt sichtbar) wird in MCP **redacted** zurückgegeben: nur Name + interner ID, keine `email`, `phone`, `notes`, `metadata`, `aliases`, `app_mappings`.
  - Alle Notes, Moments und Action-Items, die diese Person als `person_id`/Participant referenzieren, gelten automatisch als versteckt für MCP — ohne dass der Nutzer sie einzeln togglen muss.
- Genau dein „Freundin"-Use-Case: emotionale Kontextnotizen kannst du einzeln auf „visible" lassen, aber Telefon/Adresse auf dem Personenprofil bleibt für die AI unsichtbar.

**3. Globale Defaults in Settings → MCP Server**
- „New notes are visible to AI by default" (toggle, default an)
- „New people are visible to AI by default" (toggle, default an)
- „Hide all items linked to sensitive people" (toggle, default an, erklärt das Verhalten aus #2)
- Übersicht: „128 notes, 14 people, 3 moments are currently hidden from AI" mit Link auf gefilterte Ansichten.

**Discoverability**
- Beim allerersten Erstellen eines MCP-Tokens (Settings → MCP Server) ein einmaliger Hinweis: „MCP-Server sehen standardmäßig alle deine Daten. Du kannst einzelne Objekte oder ganze Personen als sensitiv markieren — auf jeder Note/Person oben rechts beim Augen-Icon."
- In Listen ein subtiler Indikator (durchgestrichenes Auge in der Ecke) bei versteckten Objekten, damit klar bleibt, was die AI nicht sieht.

## Technik (kompakt)

**Schema** (eine Migration):
- Neue Spalte `mcp_visibility text not null default 'visible'` mit Check `('visible','hidden')` auf: `notes`, `contacts`, `moments`, `collection_items`, `action_items`.
- Neue Spalte `is_sensitive boolean not null default false` nur auf `contacts`.
- Neue Settings-Spalten in `ai_suggestion_preferences` (oder neue `mcp_preferences`-Tabelle): `mcp_default_notes_visible`, `mcp_default_people_visible`, `mcp_hide_sensitive_linked` (alle bool, default true).
- Indexe: `create index on notes (user_id) where mcp_visibility = 'hidden';` analog für die anderen — billige Filterung.
- Security-Definer-Funktion `public.mcp_can_see(_user_id uuid, _kind text, _id uuid) returns boolean`, die in einem Statement Eigenvisibility + Sensitive-Vererbung über `person_id` / `moment_participants` prüft. Genutzt vom MCP-Server, nicht über RLS — RLS bleibt unverändert (User selbst soll alles sehen).

**MCP-Server (`supabase/functions/open-brain-mcp/index.ts`)**:
- Zentrale Helper hinzufügen:
  - `applyMcpFilter(query, table)` — hängt `.eq('mcp_visibility', 'visible')` an und (für notes/moments/action_items mit person_id) ein `not.in('person_id', sensitivePersonIds)`.
  - `redactContact(row)` — entfernt PII-Felder bei `is_sensitive = true`.
  - Sensitive-Personen-IDs einmal pro Request cachen (AsyncLocalStorage), nicht pro Tool-Call neu laden.
- Alle ~30 `from("notes"|"contacts"|"moments"|"action_items"|"collection_items")` Read-Stellen durch die Helper schicken (semantische Suche via `search_notes_semantic` ebenfalls: Embedding-Treffer nachträglich gegen `mcp_can_see` filtern, damit auch versteckte Treffer wegfallen).
- Write-Operationen (`create_note`, `update_contact`, `create_moment`, …): wenn das Ziel-Objekt versteckt/sensitiv ist, mit klarer Fehlermeldung ablehnen („This item is hidden from AI. Unhide it in Menerio to let MCP edit it.") — keine stille Mutation hinter dem Rücken des Nutzers.

**Frontend**:
- Neue Komponente `<McpVisibilityToggle entityType=… entityId=… />` (Eye/EyeOff von lucide), wiederverwendbar in:
  - `NoteEditor` Header
  - `PersonHeader` / `ContactProfileTab`
  - Moment-Dialog
  - Collection-Item-Detail
  - Action-Item-Row
- `SensitiveToggle` separat auf der Person mit erklärendem Popover.
- Listen-Bulk-Action via bestehenden Selection-Mechanismus (wo vorhanden).
- Settings-Seite `Settings → MCP Server` um den Defaults-Block + Counts ergänzen.

**Reihenfolge der Umsetzung**
1. Migration (Spalten + Index + `mcp_can_see` Funktion)
2. MCP-Server: zentrale Helper + Filter in allen Read/Write-Tools
3. Person-Level Sensitive-Toggle + Redaction
4. Per-Objekt Toggle-Komponente + Einbau in die fünf Detail-Views
5. Bulk-Action in Listen
6. Settings-Block + One-Time-Hinweis bei MCP-Token-Erstellung

## Was bewusst weggelassen wird (für Folge-Iteration)

- **Field-Level Redaction** über die Sensitive-Person hinaus (z.B. „nur `phone` verstecken, alles andere zeigen"). Klingt mächtig, wird in der UI aber schnell unübersichtlich — erst nachschieben, wenn Nutzer das vermissen.
- **Tag-/Collection-basierte Regeln** („alle Items mit Tag #private verstecken"). Lässt sich später leicht draufsetzen, weil `mcp_can_see` zentral ist.
- **Read-vs-Write-Trennung** pro Objekt (z.B. „AI darf lesen, aber nicht editieren"). Aktuell nur binär sichtbar/versteckt — einfacher zu verstehen.

## Verifikation

- Note mit `mcp_visibility='hidden'` taucht in `search_notes_semantic`, `list_notes`, `get_note` MCP-Calls nicht auf, aber weiterhin in der Menerio-UI.
- Person mit `is_sensitive=true`: MCP `get_contact` liefert nur Name + ID; alle Notes mit dieser `person_id` werden aus MCP-Resultaten gefiltert.
- `create_note`/`update_note` auf eine versteckte Note via MCP → Fehler mit klarer Meldung.
- Toggle in UI ändert State sofort, MCP-Aufruf direkt danach respektiert den neuen State (kein Cache-Lag pro Request).
- Settings-Counter stimmt mit DB-Realität überein.

## Geänderte/neue Dateien (Übersicht)

- `supabase/migrations/<timestamp>_mcp_visibility.sql` (neu)
- `supabase/functions/open-brain-mcp/index.ts` (Filter + Redaction überall einziehen)
- `src/components/common/McpVisibilityToggle.tsx` (neu)
- `src/components/common/SensitiveToggle.tsx` (neu)
- `src/components/notes/NoteEditor.tsx`, `src/components/people/*`, `src/components/timeline/AddEventDialog.tsx`, `src/pages/CollectionDetail.tsx`, ggf. `src/pages/Actions.tsx`-Pendant (Toggle einbauen)
- `src/components/settings/MCPConnectionManager.tsx` (Defaults + Hinweis)
- ggf. `src/hooks/useMcpVisibility.ts` (kleiner Mutation-Wrapper)
