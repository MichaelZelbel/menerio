
# Smart Chunking für die RAG-Pipeline

## Problem heute
Jede Notiz bekommt **genau ein** Embedding aus den ersten ~8.000 Zeichen (`text.slice(0,8000)` in `backfill-embeddings`, ähnlich in `process-note`). Folgen:
- Lange Notizen (Yumei DM 447k, N8N-Skill 70k) verlieren den Großteil ihres Inhalts für die semantische Suche.
- Ein einziges Embedding mittelt sehr unterschiedliche Themen zu einem unscharfen Vektor → schlechte Treffer (z. B. "Friendship Strategy" geht in einer langen Notiz unter).
- Treffer können nicht auf eine Stelle in der Notiz zeigen.

## Ziel
Notizen werden vor dem Embedding in semantisch sinnvolle Chunks zerlegt. Die Suche findet den **besten Chunk**, gibt aber weiterhin die Notiz als Ergebnis zurück (mit Snippet/Anker). Bestehende `notes.embedding`-Spalte bleibt als "Note-Level"-Vektor für schnelle Grobfilter erhalten.

## Architektur

```text
note (markdown) ──► smartChunk() ──► chunks[]
                                      │
                                      ▼
                          embed(chunk) for each chunk
                                      │
                                      ▼
                       INSERT INTO note_chunks (note_id, idx, content, embedding, ...)

Suche:
  query ─► embed ─► top-k über note_chunks (HNSW) ─► group by note_id ─► rank
```

## Smart-Chunking-Strategie (Markdown-bewusst)

Da Notizen Obsidian-Markdown sind:

1. **Splitten an Markdown-Boundaries** (in dieser Reihenfolge):
   - H1/H2/H3 Headings (`#`, `##`, `###`)
   - Horizontal rules (`---`)
   - Leere Zeilen zwischen Absätzen
   - Listenblöcke bleiben zusammen
   - Codeblocks (```` ``` ````) und Tabellen werden **nie** mittendrin geteilt
2. **Ziel-Chunk-Größe**: ~800 Tokens (~3.200 Zeichen), **max** 1.200 Tokens, **min** 200 Tokens.
3. **Merge kleine Nachbarn**: Ist ein Section-Block < 200 Tokens, an den vorherigen Chunk anhängen, solange max nicht überschritten wird.
4. **Split zu große Blöcke**: Section > 1.200 Tokens → an Absatzgrenzen (`\n\n`), notfalls an Satzgrenzen splitten.
5. **Overlap**: 1–2 Sätze (~80 Tokens) am Anfang jedes Chunks aus dem vorigen Chunk übernehmen → Kontextkontinuität.
6. **Heading-Pfad als Präfix**: Jeder Chunk wird beim Embedden mit seinem Heading-Pfad angereichert, z. B. `# Friendship Strategy > ## Core Principles\n\n…`. Verbessert semantische Treffer drastisch.
7. **Notiz-Titel** wird ebenfalls vorangestellt.
8. **Leere/triviale Chunks** (< 20 Zeichen ohne Wörter) verworfen.

## Datenbank

Neue Tabelle `note_chunks`:

| Spalte | Typ | Notiz |
|---|---|---|
| `id` | uuid PK | |
| `note_id` | uuid FK → notes(id) on delete cascade | |
| `user_id` | uuid | für RLS |
| `chunk_index` | int | Reihenfolge in der Notiz |
| `heading_path` | text | z. B. "Strategy > Core" |
| `content` | text | reiner Chunk-Text (ohne Präfix) |
| `token_count` | int | geschätzt |
| `embedding` | vector(1536) | text-embedding-3-small |
| `created_at` | timestamptz | |

Indexe: `(note_id, chunk_index)`, HNSW auf `embedding` (wie bei `notes.embedding`), `user_id`.

RLS: User darf nur eigene Chunks lesen (`user_id = auth.uid()`); Service-Role schreibt.

Neue RPC `match_note_chunks(query_embedding vector, match_user uuid, match_count int, similarity_threshold float)` → liefert `(note_id, chunk_id, chunk_index, content, heading_path, similarity)`. Anschließend in TS auf `note_id` aggregieren (max similarity), Top-N Notes zurückgeben.

`notes.embedding` bleibt: weiter aus Title + erstem Chunk berechnet, dient als Fallback und für `compute-connections`/Graph (kann später ebenfalls auf Chunk-Avg umgestellt werden).

## Code-Änderungen

1. **Neuer Shared-Helper** `supabase/functions/_shared/chunking.ts`:
   - `smartChunkMarkdown(text, { targetTokens, maxTokens, minTokens, overlapSentences }): Chunk[]`
   - `Chunk = { content, headingPath, tokenCount, index }`
   - Token-Schätzung: `Math.ceil(chars/4)` (gut genug für Budgeting).
2. **`process-note`**:
   - Nach Metadata-Extraktion: chunks erzeugen, je Chunk ein Embedding via `getEmbeddingWithCredits`, in `note_chunks` upserten (vorher alte Chunks der Note löschen).
   - Note-Level-Embedding weiter setzen, aber aus `title + firstChunk.content`.
   - Fortschritt + Fehlerstatus in `metadata.chunking = { count, last_error, updated_at }`.
3. **`backfill-embeddings`**:
   - Statt nur `notes.embedding` setzt es Chunks **und** Note-Level-Embedding.
   - Limit-Parameter zählt jetzt Notizen, nicht Chunks; UI-Text in `Admin.tsx` anpassen.
   - Pro Notiz Hard-Cap (z. B. 50 Chunks), bei Überschreitung warnen und in `metadata.chunking.truncated = true` markieren.
4. **Such-Pfade umstellen** auf `match_note_chunks` mit anschließender Aggregation:
   - `search-notes-semantic`
   - `open-brain-mcp` (`search_notes`, `search_brain`, `search_thoughts`)
   - `note-chat` / `conversation-chat` Kontext-Retrieval
   - Ergebnis-Snippet = Treffer-Chunk (kürzt UI-seitig auf 240 Zeichen + `heading_path` als Sublabel).
5. **Credit-Schutz**: Vor dem Chunk-Loop `checkBalance` mit geschätzten Credits (`chunks.length * embeddingCost`) prüfen; bei zu wenig Credits nur erste N Chunks embedden und Rest auf "deferred" setzen (passt zur bestehenden Defer-Logik aus dem vorigen Plan).
6. **Connection-Recompute**: `compute-connections` bleibt erstmal note-level; Issue/Note für Folge-Iteration anlegen (Chunk-zu-Chunk-Connections sind out-of-scope).

## Migration / Rollout

1. Migration: `note_chunks` + RLS + HNSW-Index + `match_note_chunks`-RPC anlegen.
2. Code-Deploy mit Feature-Flag `CHUNKING_ENABLED` (env). Zunächst nur in `backfill-embeddings` aktiv, damit wir an einem Stapel testen.
3. Admin-Backfill-Button auf neuer Logik laufen lassen, "Friendship Strategy" und 30 betroffene Notizen verifizieren (Chunk-Count > 0, Suche findet Treffer).
4. Flag in `process-note` aktivieren → ab da entstehen Chunks beim Capture.
5. Such-Edge-Functions auf `match_note_chunks` umstellen (parallele Phase: erst neben, dann statt note-level Suche).
6. Cleanup: alte `slice(0,8000)`-Stellen entfernen.

## Out of Scope (separat besprechen)
- Chunk-Embeddings für Lexicon/Wiki-Pages (gleiches Schema, andere Tabelle).
- Re-Ranker (z. B. cross-encoder) über Top-K Chunks.
- Chunk-Anker im Editor (Scroll-zu-Snippet).
