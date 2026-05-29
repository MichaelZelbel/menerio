# Visible to AI – konsolidiertes Sichtbarkeits-Modell

## Konzept

Das bisherige `mcp_visibility` Feld wird semantisch erweitert: **Hidden = "AI fasst diese Notiz nicht an"** — weder MCP-Clients, noch interne AI-Pipelines, noch Ableitungen ins Lexicon, in People-Profile oder in den Knowledge Graph.

Embeddings werden weiterhin generiert, damit **du** die Notiz über die lokale semantische Suche findest. MCP-seitige semantische Suche filtert Hidden-Notes konsequent raus.

## Was "Hidden" ab sofort blockiert

| Pipeline | Verhalten bei `hidden` |
|---|---|
| MCP-Tools (alle Lese-/Schreib-Tools) | Wie bisher: Note nicht sichtbar/editierbar |
| **`wiki-ingest` (Lexicon)** | Note wird übersprungen, trägt nichts zu Lexicon-Sections bei |
| **People-Enrichment** (Personen-Attribute, Beziehungen, Profile-Suggestions) | Note fließt nicht in `generate-profile-suggestions`, `extract-event`, People-Matching ein |
| **Knowledge Graph** (`get-graph-data`, `compute-connections`) | Note erscheint nicht als Node, keine Connection-Computation |
| **AI Suggestions / Suggested Connections / Discovery Feed** | Note wird nicht als Quelle oder Ziel vorgeschlagen |
| **In-App AI-Chat** (Note Chat & Global Chat) | Note wird nicht als Kontext geladen |
| **Daily Digest / Today's Connections / Weekly Review** | Note bleibt außen vor |
| **Embeddings & lokale Suche** | ✅ Werden weiter generiert. ILIKE + semantische Suche **in der App** zeigt die Note. MCP-Search-Endpoint filtert sie weg. |

## Was passiert mit bereits abgeleiteten Daten (retroaktiv)

Kein automatischer Rollback (zu riskant, zu schwer sauber zu machen). Stattdessen:

- Beim Umschalten auf `hidden` öffnet sich ein **"AI-Footprint"-Dialog**, der listet:
  - Lexicon-Sections, zu denen diese Note beigetragen hat (über `wiki_section_sources` / Provenance)
  - People-Profile-Felder mit dieser Note als Quelle (`profile_entries.source_note_id`)
  - Knowledge-Graph-Edges, die durch diese Note entstanden sind (`note_connections`)
- Pro Eintrag ein "Remove"-Button. Bulk-Action "Remove all derived data".
- Im AI-Chat-Sidebar der Note ein dezenter Hinweis "Hidden from AI — past contributions still exist, [review]".

## UI-Änderungen

- `McpVisibilityButton` → **`AiVisibilityButton`** (Datei umbenennen, alle Imports anpassen)
- Label: **"AI"** (sichtbar) / **"Hidden"** (versteckt)
- Tooltip neu: *"Visible to AI: used in Lexicon, People profiles, Knowledge Graph, AI Chat, and MCP clients."* / *"Hidden from AI: this note is excluded from Lexicon, People, Graph, AI Chat, and MCP. Local search still finds it."*
- Settings-Seite "MCP Preferences" → **"AI Visibility"**: `hide_sensitive_linked` umbenannt zu `hide_sensitive_from_ai`, Beschreibungstexte überarbeitet.
- Person-Toggle (`is_sensitive`) bekommt klarere Beschriftung: *"Sensitive — hidden from all AI features"*.

## Technische Umsetzung

### DB
- Migration: `mcp_visibility` Spalten umbenennen → **`ai_visibility`** (Werte `visible` / `hidden`) auf `notes`, `contacts`, `moments`, `collection_items`, `action_items`. Default-Werte und Indizes mitziehen.
- `mcp_preferences` Tabelle umbenennen → `ai_visibility_preferences`. Spalte `hide_sensitive_linked` → `hide_sensitive_from_ai`.
- RPC `mcp_can_see` → `ai_can_see` (gleiche Logik, neuer Name).
- View / Helper: `notes_for_ai(user_id)` als zentrale Quelle für alle Edge-Functions, die "AI-zugelassene" Notes brauchen.

### Shared Helper
- `supabase/functions/_shared/ai_visibility.ts` (aus `open-brain-mcp/_mcp_visibility.ts` herausgezogen und verallgemeinert):
  - `applyAiVisibility(query, table, supabase, userId)`
  - `filterVisibleForAi(rows, supabase, userId)`
  - `assertAiWritable(...)`
  - `getSensitivePersonIds(...)` (unverändert)

### Edge-Functions, die den Helper neu nutzen müssen
| Function | Anpassung |
|---|---|
| `wiki-ingest` | Skip wenn `note.ai_visibility = 'hidden'` oder `person_id ∈ sensitive`. Vor Insert in `wiki_section_sources` prüfen. |
| `wiki-cleanup`, `backfill-wikilinks` | Gleiche Filterung. |
| `generate-profile-suggestions`, `extract-event`, `draft-event` | Source-Notes filtern. |
| `compute-connections`, `recompute-all-connections`, `get-graph-data` | Hidden Notes als Quelle UND Ziel ausschließen. |
| `suggest-connections`, `find-connections`, Discovery Feed | Gleiches. |
| `note-chat`, `conversation-chat`, Global Chat | Kontext-Notes filtern. |
| `daily-digest`, `weekly-review` | Filtern. |
| `search-notes-semantic` | **Neu**: Parameter `caller: 'app' \| 'mcp'`. Für `'app'` zeigt Hidden-Notes (mit Badge), für `'mcp'` filtert sie raus. |
| `process-note` | Beim Insert/Update einer Hidden-Note KEINE AI-Ableitungen triggern, nur Embedding generieren. |

### Frontend
- `useNotes`, `useGraphData`, Lexicon-Hooks: bestehende `is_trashed`-Filter erweitern um optional `includeHidden` (Default: true für UI, weil User sie sehen darf).
- Note-Karten/Listen zeigen ein dezentes "Hidden from AI"-Badge.
- Knowledge-Graph: Hidden-Notes-Toggle in der Sidebar ("Show hidden from AI") — Default off, da User sie absichtlich versteckt hat.
- Lexicon-Seite & People-Profile: Hidden-Notes erscheinen nicht in den abgeleiteten Sektionen, aber bleiben in der rohen "Linked Notes"-Liste sichtbar (mit Badge).
- Neuer Komponente `AiFootprintDialog.tsx`: zeigt Provenance beim Umschalten.

### Migration alter Begriffe
- Alle UI-Strings "MCP" → "AI" wo es um Visibility geht. Connector-Sektionen (`MCPConnectionManager`, `MCP API Tokens`) bleiben "MCP" — das sind echte Protokoll-Namen.
- Memory-Files aktualisieren: `mem://features/notes`, evtl. neuer Eintrag `mem://features/ai-visibility`.

## Out of Scope (für später)

- Automatischer Rollback von Lexicon/Profile-Beiträgen (kann Phase 2 sein, falls "Markieren & Warnen" nicht reicht).
- Per-Pipeline-Opt-out für Power-User (z. B. "diese Note: nur Lexicon ja, Graph nein"). Aktuell ein einziger Toggle.
- Verschlüsselung von Hidden-Notes (separates Feature).

## Reihenfolge der Umsetzung

1. **DB-Migration** + RPC-Rename (atomar, mit Backwards-Alias-Views falls nötig).
2. **Shared `ai_visibility.ts`** Helper + Tests.
3. Alle **Edge-Functions** durchgehen (Liste oben).
4. **Frontend-Rename** `McpVisibilityButton` → `AiVisibilityButton`, Tooltips, Badges.
5. **AiFootprintDialog** mit Provenance-Übersicht.
6. **Settings-Seite** umlabeln.
7. Memory-Updates.

## Risiken

- **Breaking Change** in Edge-Functions, die `mcp_visibility` direkt referenzieren — sauberer Sweep nötig (rg-Suche vor Migration).
- **Performance**: Mehr Filter in mehr Pipelines. Bestehende Indizes auf `mcp_visibility` umbenennen, nicht neu erstellen.
- **User-Erwartung**: User die heute eine Note "MCP-hidden" haben, finden sie morgen plötzlich nicht mehr im Graph. Migration sollte mit einem In-App-Hinweis ("Wir haben MCP-Visibility erweitert zu AI-Visibility — deine 12 versteckten Notes sind jetzt komplett aus AI-Pipelines raus.") begleitet werden.
