# Warum „Thoughts" und warum „Friendship Strategy" nicht gefunden wurde

## Befund 1 — Woher das Wort „Thoughts" kommt

Im MCP-Server (`supabase/functions/open-brain-mcp/index.ts`) sind die Tools, die deine Agenten Hermes/OpenClaw aufrufen, durchgängig in „Thought"-Sprache benannt:

| Tool-Name | Title | Description-Auszug |
|---|---|---|
| `search_thoughts` | „Search Thoughts" | „Search captured **thoughts** by meaning…" |
| `list_recent` | „List Recent **Thoughts**" | „List recently captured **thoughts**…" |
| `capture_thought` | „Capture Thought" | „Save a new **thought** to the Open Brain…" |
| `get_stats` | — | „…summary of all captured **thoughts**…" |

Außerdem geben die Antworten Strings wie „Found N **thought(s)**", „No **thoughts** found." zurück. Das ist der gesamte Wortschatz, mit dem die Agenten konfrontiert werden — sie übernehmen ihn 1:1, wenn sie über das Konzept reden. Das hat historische Gründe (Open-Brain-Begrifflichkeit aus der ersten Version), passt aber nicht mehr zum heutigen User-Vokabular „Notes".

## Befund 2 — „Friendship Strategy" existiert zweimal

DB-Check ergab:

- `notes`-Tabelle: Notiz **„Friendship Strategy"** (nicht im Trash)
- `wiki_pages`-Tabelle: Lexicon-Page **„Friendship Strategy"** (page_type `overview`)

Heißt: die Notiz **gibt es**. `search_thoughts` hat einen ILIKE-Fallback auf `title`/`content` und sollte sie finden. Es gibt aber zwei plausible Erklärungen, warum Hermes leer ausging:

1. **Hermes hat das falsche Tool gewählt.** Wenn er „Friendship Strategy" als Konzept versteht, ruft er `lexicon_search` auf — und kriegt nur die Wiki-Page. Sucht er sie **als Notiz**, ruft er `search_thoughts` — kriegt aber bei der semantischen Suche evtl. einen schwachen Score (Threshold 0.25) und der ILIKE-Fallback scheitert nur, wenn die Anfrage ungewöhnlich formuliert war (z. B. ganzer Satz). Es gibt kein **kombiniertes** Tool, das Notes + Lexicon gemeinsam durchsucht.
2. **Tool-Descriptions trennen die beiden Welten unsauber.** `search_thoughts` erwähnt Lexicon nicht, `lexicon_search` erwähnt Notes nicht. Der Agent muss raten.

Edge-Function-Logs zeigen keine Tool-Call-Details (MCP-Server loggt das nicht), daher können wir nicht final beweisen, **welches** Tool Hermes aufgerufen hat — aber beide Erklärungen führen zu derselben Fix-Richtung.

---

## Plan

### A. „Notes" statt „Thoughts" durchziehen

In `supabase/functions/open-brain-mcp/index.ts`:

1. **Neue Tool-Namen** (semantisch klar):
   - `search_thoughts` → `search_notes`
   - `list_recent` → `list_recent_notes` (Title schon „Notes" lassen)
   - `capture_thought` → `capture_note`
   - Title/Description bei allen restlichen Tools (`get_stats`, `get_action_items`, etc.) auf „note(s)" umstellen.
2. **Backward-Compat-Aliase**: Alte Namen (`search_thoughts`, `capture_thought`, `list_recent`) bleiben **zusätzlich** als dünne Delegate-Tools registriert mit Description „Deprecated alias for `search_notes` — use the new name." So brechen bestehende Hermes-/OpenClaw-Konfigurationen nicht.
3. Antwort-Strings („Found N thought(s)" etc.) auf „note(s)" umstellen.
4. Auch in `supabase/functions/ingest-thought/index.ts` die User-facing Confirmation-Strings („Captured as *thought*") anpassen — die Datei selbst behalten wir aus Routing-Gründen, aber die Wörter werden „note".

### B. Suche gezielter machen

1. **`search_notes`-Description erweitern** um den Hinweis, dass es **nur** persönliche Notizen durchsucht und für synthesierte Themen-Pages das Lexicon-Tool verwendet werden soll: „If the user asks about a synthesized topic / strategy / concept and you don't find a note, also call `lexicon_search`."
2. **`lexicon_search`-Description spiegeln**: „If the user asks about a raw captured idea, prefer `search_notes` first; use Lexicon for synthesized topic pages."
3. **Optional, empfohlen**: Neues Tool **`search_brain`** ergänzen, das in **einem** Aufruf parallel `match_notes` (semantisch + ILIKE) **und** `wiki_pages` ILIKE durchführt und die Treffer gemerged zurückgibt — gekennzeichnet als `note` oder `lexicon`. Das ist das Tool, das wir der Agent als Default empfehlen („Use this when the user asks about anything in their brain and you're not sure whether it's a captured note or a synthesized topic page."). `search_notes`/`lexicon_search` bleiben für gezielte Suchen.
4. ILIKE-Query in `search_notes` defensiver machen: Komma im `query` escapen (PostgREST `.or()` benutzt Komma als Separator → bricht Suche bei Anfragen wie „Friendship Strategy, my plan").

### C. Verifizieren

1. Edge Function deployen, mit `supabase--curl_edge_functions` einen `tools/list` und einen `tools/call: search_notes {query: "Friendship Strategy"}` mit deinem `mnr_`-Token absetzen → erwarten: 1 Treffer.
2. Außerdem `search_brain {query: "Friendship Strategy"}` testen → erwarten: 2 Treffer (1 note + 1 lexicon page).

---

## Technische Notizen für die Umsetzung

- **Keine DB-Migration nötig.** Reine Edge-Function-Änderung.
- Aliase per zweitem `server.registerTool(...)` mit identischem Handler — minimaler Boilerplate.
- `search_brain` kann intern dieselbe Logik wie `search_thoughts` + `lexicon_search` aufrufen (Funktionen extrahieren statt Code duplizieren).
- Memory-Eintrag `mem://integrations/mcp-and-slack-hub` muss um den neuen Tool-Namen ergänzt werden.
- Konstante: Welche Tool-Namen ändern sich? → in `docs/ARCHITECTURE.md` (falls dort dokumentiert) nachziehen. Kurz prüfen.

Soll ich so weitermachen?