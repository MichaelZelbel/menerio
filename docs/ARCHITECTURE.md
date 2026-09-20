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
│  - Auth (email/password)        │
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

~40 Deno-based edge functions organised by feature:

| Group | Functions |
|-------|-----------|
| **AI / LLM** | `note-chat`, `conversation-chat`, `process-note`, `ai-moderate-content`, `generate-profile-suggestions`, `search-notes-semantic`, `suggest-group-next-step`, `generate-group-briefing` |
| **Media** | `analyze-media`, `analyze-pdf`, `backfill-media-analysis` |
| **Connections / Graph** | `compute-connections`, `find-connections`, `suggest-connections`, `recompute-all-connections`, `get-graph-data` |
| **Groups** | `suggest-group-members`, `generate-group-briefing`, `suggest-group-next-step` |
| **Lexicon** | `wiki-ingest`, `wiki-lint` |
| **Hub API** | `hub-api-keys`, `hub-api-notes`, `hub-api-contacts`, `hub-api-actions`, `hub-api-stats` |
| **MCP Server** | `menerio-mcp` |
| **Sync / Import** | `github-sync-export`, `github-sync-pull`, `github-import-vault`, `github-sync-scheduled` |
| **Capture** | `quick-capture`, `ingest-thought`, `telegram-capture`, `discord-capture`, `slack-capture`, `receive-note` |
| **Moderation** | `moderate-content`, `ai-moderate-content` |
| **Inter-app** | `send-patch`, `patch-response`, `receive-note`, `verify-connection` |
| **Other** | `daily-digest`, `weekly-review`, `extract-event`, `delete-my-account`, `ensure-token-allowance`, `get-shared-note`, `link-note` |

Shared helpers live in `supabase/functions/_shared/` (auth, rate limiting, LLM credit accounting, Hub helpers, group note import logic, hashing).

### Hub mirror notes

A user's hub (a git folder of Markdown files their AI assistants work from) can be mirrored into Menerio through `hub-api-notes` with `source_app: "hub"`, `source_id: "<hub path>"` and `folder_path: "hub/<dir>"`. These notes share the `notes` table with everything the user wrote, and five rules keep them apart. `_shared/hub-source.ts` decides what a hub note is (`isHubMirror`, case- and space-insensitive); `_shared/hub-ranking.ts` holds the ranking numbers, with a frontend twin in `src/lib/hub-ranking.ts` that a test keeps in step.

| Rule | Where |
|------|-------|
| Indexed for search, never mined for facts | `process-note` index-only path (`shouldExtractFacts`) |
| Ranked below native notes: similarity × 0.85 for ordering, one tier lower where ranking is tiered, native first only on a tie | MCP `search_notes` / `search_brain`, `search-notes-semantic`, `hub-api-notes` `GET /search`, the app's keyword scorer (`src/lib/search-terms.ts`) |
| Labelled `[hub file: <source_id>]` in MCP results; `search_notes` takes `source: all \| native \| hub` | `menerio-mcp` |
| Not exported to the GitHub vault (bulk and single note). Files an earlier export pushed under `hub/` are left in place, not deleted | `github-sync-export` |
| Nothing else may be filed in or under the `hub` folder | MCP `capture_note`, `update_note` |

### MCP note filing

`capture_note` takes `content` plus optional `title`, `folder_path` and `tags`, and answers with the note id, final title, folder and up to five related existing notes found with the embedding it just computed (none when indexing was deferred for lack of credits). `list_note_folders` returns folder paths with note counts so an assistant can pick the folder first. `[[Exact Title]]` in a body written through `capture_note` or `update_note` becomes a `manual_link` row in `note_connections` (`_shared/wikilinks.ts`), which is what the editor does on save and `process-note` does not. Both tools live in `menerio-mcp/note-filing-tools.ts`.

### Hub API search

`GET /hub-api-notes/search?q=…` runs a vector arm (`match_note_chunks`, query embedding charged to the key's owner) and an ILIKE arm inside the function (`_shared/note-search.ts`); it does not call another edge function. Optional `source_app` (`hub`, `native`, or any sender name) and `limit` (default 10, max 50). Each result carries `id, title, folder_path, source_app, source_id, updated_at, similarity, snippet`, and the response carries `mode`: `semantic+text`, or `text_only` when credits are exhausted or the embedding call fails.

### Database

PostgreSQL with Row-Level Security. The schema is managed through migrations in `supabase/migrations/` (read-only, generated by Supabase). TypeScript types are auto-generated in `src/integrations/supabase/types.ts`.

## Data Flow

1. The React app calls Supabase directly (queries, auth) via the JS client.
2. For AI or complex operations, the app invokes edge functions.
3. Edge functions read/write the database using server-side credentials and must scope operations to the authenticated user or validated API token.
4. External integrations (Telegram, Discord, Slack, GitHub, Hub API clients, MCP clients) communicate through dedicated capture/sync/API functions.
5. AI-heavy functions use the shared credit system and should use background execution patterns where needed to avoid timeouts.

## Configuration

| File | Purpose |
|------|---------|
| `.env.example` | Public configuration template; runtime secrets are managed by Lovable/Supabase, not committed files |
| `supabase/config.toml` | Edge function settings (JWT verification) |
| `tailwind.config.ts` | Design tokens and theme |
| `vite.config.ts` | Build configuration |
