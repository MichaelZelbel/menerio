# Architecture

Menerio is a client-side React application backed by Supabase for authentication, database, storage, and serverless functions.

## Layers

```
┌─────────────────────────────────┐
│  Browser (React SPA)            │
│  - UI components & pages        │
│  - Client-side state (React Q.) │
│  - Supabase JS client           │
└──────────┬──────────────────────┘
           │ HTTPS
┌──────────▼──────────────────────┐
│  Supabase                       │
│  - Auth (email, Google, GitHub) │
│  - PostgreSQL (RLS-protected)   │
│  - Edge Functions (Deno)        │
│  - Storage (attachments/media)  │
└─────────────────────────────────┘
```

There is **no custom backend server**. All server-side logic runs as Supabase Edge Functions.

## Frontend (`src/`)

| Directory | Purpose |
|-----------|---------|
| `pages/` | Route-level components (one per page), including Notes, People, Groups, Lexicon, Review Queue, Media, and Settings |
| `components/` | Reusable UI, grouped by domain (`notes/`, `people/`, `groups/`, `settings/`, `admin/`, `layout/`, `ui/`, etc.) |
| `hooks/` | Custom React hooks (data fetching, subscriptions, utilities) |
| `contexts/` | React context providers (`AuthContext`) |
| `integrations/supabase/` | Auto-generated Supabase client and TypeScript types |
| `lib/` | Shared utilities (error handling, content helpers, upload logic) |
| `content/docs/` | In-app documentation content and registry |
| `utils/` | Pure utility functions (e.g. markdown conversion) |

### Routing

React Router v6 with two layout wrappers:

- **`PageLayout`** — public pages (landing, docs, legal)
- **`DashboardLayout`** — authenticated pages (dashboard, notes, people, groups, lexicon, graph, media, settings, etc.)

Routes are lazy-loaded for code splitting.

Key authenticated routes:

| Route | Purpose |
|-------|---------|
| `/dashboard/notes` and `/dashboard/notes/:noteId` | Markdown-native note workspace with rich editor, wikilinks, source mode, sharing, media, and AI chat |
| `/dashboard/people` | Contact/person profiles, relationships, timeline, documents, and duplicate merging |
| `/dashboard/groups` and `/dashboard/groups/:slug` | Group workspaces for people pipelines, goals, member stages, briefings, and note-based imports |
| `/lexicon` and `/lexicon/:slug` | Synthesized knowledge pages with sources, backlinks, revisions, and manual editing |
| `/dashboard/review-queue` | Review workflow for AI suggestions, dedupe, relationships, profile enrichment, and group-member proposals |
| `/dashboard/media` | Searchable library of analyzed note attachments |

## Supabase (`supabase/`)

### Edge Functions (`supabase/functions/`)

About 90 Deno-based edge functions; the main ones, organised by feature:

| Group | Functions |
|-------|-----------|
| **AI / LLM** | `note-chat`, `conversation-chat`, `process-note`, `ai-moderate-content`, `generate-profile-suggestions`, `search-notes-semantic`, `suggest-group-next-step`, `generate-group-briefing` |
| **Media** | `analyze-media`, `analyze-pdf`, `backfill-media-analysis` |
| **Connections / Graph** | `compute-connections`, `find-connections`, `suggest-connections`, `recompute-all-connections`, `get-graph-data` |
| **Groups** | `suggest-group-members`, `generate-group-briefing`, `suggest-group-next-step` |
| **Lexicon** | `wiki-ingest`, `wiki-lint` |
| **Mission Control API** | `mc-api-keys`, `mc-api-notes`, `mc-api-contacts`, `mc-api-actions`, `mc-api-stats`, `mc-api-world`, `mc-connect` |
| **MCP Server** | `menerio-mcp` |
| **Sync / Import** | `github-sync-export`, `github-sync-pull`, `github-import-vault`, `github-sync-scheduled` |
| **Capture** | `quick-capture`, `ingest-thought`, `telegram-capture`, `discord-capture`, `slack-capture`, `receive-note` |
| **Moderation** | `moderate-content`, `ai-moderate-content` |
| **Inter-app** | `send-patch`, `patch-response`, `receive-note`, `verify-connection` |
| **Other** | `daily-digest`, `weekly-review`, `extract-event`, `delete-my-account`, `ensure-token-allowance`, `get-shared-note`, `link-note` |

Shared helpers live in `supabase/functions/_shared/` (auth, rate limiting, LLM credit accounting, Mission Control helpers, group note import logic, hashing).

### Mission Control mirror notes

A user's mission control (a git folder of Markdown files their AI assistants work from) can be mirrored into Menerio through `mc-api-notes` with `source_app: "godspeed"`, `source_id: "<godspeed path>"` and `folder_path: "godspeed/<dir>"`. These notes share the `notes` table with everything the user wrote, and five rules keep them apart. `_shared/mc-source.ts` decides what a mission control note is (`isGodspeedMirror`, case- and space-insensitive); `_shared/mc-ranking.ts` holds the ranking numbers, with a frontend twin in `src/lib/mc-ranking.ts` that a test keeps in step.

| Rule | Where |
|------|-------|
| Indexed for search, never mined for facts | `process-note` index-only path (`shouldExtractFacts`) |
| Ranked below native notes: similarity × 0.85 for ordering, one tier lower where ranking is tiered, native first only on a tie | MCP `search_notes` / `search_brain`, `search-notes-semantic`, `mc-api-notes` `GET /search`, the app's keyword scorer (`src/lib/search-terms.ts`) |
| Labelled `[godspeed file: <source_id>]` in MCP results; `search_notes` takes `source: all \| native \| godspeed` | `menerio-mcp` |
| Not exported to the GitHub vault (bulk and single note). Files an earlier export pushed under `godspeed/` are left in place, not deleted | `github-sync-export` |
| Nothing else may be filed in or under the `godspeed` folder | MCP `capture_note`, `update_note` |

### Connecting a mission control

A mission control can get its key without anyone copying one. Mission Control asks (`mc-connect` `POST /start`), opens `/connect-godspeed?request=...&code=...` in the browser, the signed-in person compares the code and confirms, and Mission Control collects the key (`POST /token`). The key is minted the same way as one made under Settings, API Keys (`_shared/mc-key-mint.ts`), stored only as a hash, and returned exactly once.

| Route | Who calls it | Proof |
|-------|--------------|-------|
| `POST /start` | Mission Control | none; ten an hour per caller address (stored as a keyed hash) |
| `GET /request`, `POST /approve` | the approval page | the person's session. The first account to open a request owns it; any other account gets 404 |
| `POST /token` | Mission Control, every 3 seconds | the PKCE verifier (S256) whose challenge `/start` was given |
| `GET /status` | every device of Mission Control | `Bearer mnr_...`; records last contact and what each assistant reported |
| `POST /disconnect` | Mission Control, or Settings | `Bearer mnr_...` of that connection, or the session plus `connection_id` |

A request lasts ten minutes. Five wrong comparison codes deny it, five wrong verifiers end it, and a key can be collected once; afterwards `/token` answers `expired_token`. The numbers, the code alphabet, the status table and the error codes are in `_shared/mc-connect-protocol.ts` (pure, tested under vitest). Everything that changes more than one row is a `godspeed_connect_*` SQL function (migration `20260920120000_godspeed_connections.sql`): one transaction each, the request row locked while it is decided so the limits hold for parallel guesses, executable by the service role only, and each told who is acting rather than trusting an id.

**The generation rule.** `godspeed_connections` has one row per (account, Mission Control) with a `generation` that rises by one on every fresh approval. A key minted through this flow carries `godspeed_connection_id` and `generation`. `lookupGodspeedKey` in `_shared/mc-auth.ts`, the one function in front of `menerio-mcp`, every `mc-api-*` function and `singlefile-capture`, accepts such a key only while its connection is `active` and the two generations are equal; otherwise the answer is 401 "This mission control's connection to Menerio was ended." So connecting again, or disconnecting, cuts off every device that still carries the old key on its next request, whatever that device has on disk. Approving and disconnecting also set `is_active = false` on the affected keys, so Settings, API Keys tells the same story. A key with no `godspeed_connection_id` (every key made by hand) is read exactly as before and is never touched by any of this; `/status` answers `{ "connected": true, "legacy_key": true }` for it.

`godspeed_devices` is status for the Connected mission controls card in Settings, Integrations (`ConnectedGodspeedsCard.tsx`), never a security boundary: revocation is per mission control. `scripts/test-godspeed-connect.mjs` runs the whole flow, the limits under parallel bursts, the generation rule through the real `lookupGodspeedKey`, and row-level security against a disposable local Postgres.

### MCP note filing

`capture_note` takes `content` plus optional `title`, `folder_path` and `tags`, and answers with the note id, final title, folder and up to five related existing notes found with the embedding it just computed (none when indexing was deferred for lack of credits). `list_note_folders` returns folder paths with note counts so an assistant can pick the folder first. `[[Exact Title]]` in a body written through `capture_note` or `update_note` becomes a `manual_link` row in `note_connections` (`_shared/wikilinks.ts`), which is what the editor does on save and `process-note` does not. Both tools live in `menerio-mcp/note-filing-tools.ts`.

### Mission Control API search

`GET /mc-api-notes/search?q=…` runs a vector arm (`match_note_chunks`, query embedding charged to the key's owner) and an ILIKE arm inside the function (`_shared/note-search.ts`); it does not call another edge function. Optional `source_app` (`godspeed`, `native`, or any sender name) and `limit` (default 10, max 50). Each result carries `id, title, folder_path, source_app, source_id, updated_at, similarity, snippet`, and the response carries `mode`: `semantic+text`, or `text_only` when credits are exhausted or the embedding call fails.

### Database

PostgreSQL with Row-Level Security. The schema is managed through migrations in `supabase/migrations/`: most were generated by Lovable (UUID-suffixed names), the rest are hand-written SQL with descriptive names. TypeScript types are auto-generated in `src/integrations/supabase/types.ts`.

## Data Flow

1. The React app calls Supabase directly (queries, auth) via the JS client.
2. For AI or complex operations, the app invokes edge functions.
3. Edge functions read/write the database using server-side credentials and must scope operations to the authenticated user or validated API token.
4. External integrations (Telegram, Discord, Slack, GitHub, Mission Control API clients, MCP clients) communicate through dedicated capture/sync/API functions.
5. AI-heavy functions use the shared credit system and should use background execution patterns where needed to avoid timeouts.

## Configuration

| File | Purpose |
|------|---------|
| `.env.example` | Public configuration template; runtime secrets are managed by Lovable/Supabase, not committed files |
| `supabase/config.toml` | Edge function settings (JWT verification) |
| `tailwind.config.ts` | Design tokens and theme |
| `vite.config.ts` | Build configuration |
