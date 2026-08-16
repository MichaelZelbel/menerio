# Offline-first architecture

Menerio's offline support has two layers:

**Layer 1 — offline shell + read cache (live since 2026-07-10).**
The app is an installable PWA (`vite-plugin-pwa`, service worker precaches the
app shell). TanStack Query results persist to IndexedDB
(`src/lib/query-persister.ts`), so every screen shows last-seen data with no
connection. Data requests are never cached by the service worker.

**Layer 2 — local-first core (PowerSync), behind the `OFFLINE_CORE` flag.**
Core entities (Phase 1: `notes`) live in a local SQLite database
(`@powersync/web`, wasm) that is the source of truth for reads AND writes.
PowerSync syncs it with Supabase in the background:

- **Down:** the PowerSync service tails the `powersync` Postgres publication
  (`supabase/migrations/20260710120000_powersync_publication.sql`) and streams
  per-user rows to devices (sync rules keyed on `request.user_id()`; the
  `embedding` column is never synced).
- **Up:** `src/sync/connector.ts` replays queued local writes through the
  normal supabase-js client — RLS, the `updated_at` trigger, and all server
  behavior apply unchanged. `updated_at` is stripped from uploads (trigger-owned).
- **Conflicts** (same note edited on two devices while offline): column-level
  last-writer-wins. Rare single-user event; conflict copies are Phase 2.

Key files: `src/lib/flags.ts` (flag), `src/sync/schema.ts` (client schema),
`src/sync/db.ts`, `src/sync/connector.ts`, `src/sync/SyncManager.tsx`
(connection lifecycle, per-user wipe), `src/sync/config.ts` (endpoint),
`src/hooks/useNotes.ts` (branching hooks: local SQLite vs Supabase).

## Enabling the flag

- Per device (works on production, no rebuild): open
  `https://menerio.com/?offline-core=on` (or `=off` to revert) — works on
  iPhone Safari; or `localStorage.setItem("menerio:offline-core", "true")`.
- Globally: flip the default in `src/lib/flags.ts` once sync has soaked.

Without a PowerSync endpoint configured the local database still works fully
offline (writes queue locally); background sync just stays off.

## The instance is GONE (2026-08-16) and the app now survives that

`6a5158557f33bac37ef5cf80.powersync.journeyapps.com` returns **NXDOMAIN**. The
parent `powersync.journeyapps.com` still resolves, so this is the instance being
deprovisioned, not a network fault. Everything below about the live setup is kept
as the record of how it was built, but it does not describe anything running.

**What that did, and why nobody noticed.** Every local-first device (all desktop
builds, plus any browser that ever visited `?offline-core=on`) kept reading a
local SQLite database that could no longer be updated. `SyncManager` reported the
failure through `console.warn`, which `vite.config.ts` strips from production
(`drop: ["console"]`); it tried once per page load and never retried; and the
Notes screen read local SQLite unconditionally. The result was a note list that
looked completely normal and was weeks stale. It surfaced only when hub folders
written straight into Postgres never appeared in the UI.

**What now happens instead** (`src/sync/reachability.ts`, `src/sync/sync-health.ts`):

- Before connecting, the app asks whether the host answers. This is a separate
  probe because `db.connect()` **cannot** report this: it starts a background
  stream that retries on its own and never rejects, so a deleted service and a
  slow one look identical to the caller.
- If it does not answer, `sync-health` goes `unreachable` and **reads and writes
  both** move to the server (`useNotes` → `useNotesLocalWithFallback`,
  `isLocalFirstActive()` in every mutation). They move together on purpose:
  reading from the server while writing to a queue that can never drain would
  make a person's own edit vanish as they typed it.
- It is visible: `OfflineIndicator` shows "Not syncing", plus the count of edits
  that exist only on that device, and Settings → Local copy explains why.
- It retries on a backoff (15s, 30s, 60s, then every 5 min), so restoring the
  service heals every open client without a reload.

**If you re-provision:** create the instance, put its URL in `src/sync/config.ts`,
redo the four setup steps below, and the probe will let clients back onto the
local-first path on their own.

## PowerSync Cloud instance (provisioned 2026-07-10, E2E verified, now deprovisioned)

Live setup: project **Menerio**, instance **Production** (EU) under Michael's
PowerSync account (michael@zelbel.de); endpoint
`https://6a5158557f33bac37ef5cf80.powersync.journeyapps.com` (hardcoded in
`src/sync/config.ts`). An unused **Development** instance (us) occupies the
second free-plan slot. Verified end-to-end: initial sync down (all notes into
local SQLite), local insert → Postgres, server insert → local within seconds,
local delete → Postgres, Notes UI rendering from SQLite.

What the setup required (for re-provisioning or a second environment):

1. Supabase SQL (privileged role, SQL editor):

   ```sql
   create role powersync_role with replication login password '<generated>';
   grant select on public.notes to powersync_role;
   create publication powersync for table public.notes;  -- also in migrations
   ALTER ROLE powersync_role BYPASSRLS;  -- else the snapshot reads 0 rows
   ```

   When new tables join the subset: `alter publication powersync add table
   public.<t>;` plus `grant select`.
2. Dashboard → Database Connections: direct connection URI
   `postgresql://powersync_role:<pw>@db.tjeapelvjlmbxafsmjef.supabase.co:5432/postgres`.
3. Dashboard → Client Auth: enable "Use Supabase Auth", set JWKS URI to
   `https://tjeapelvjlmbxafsmjef.supabase.co/auth/v1/.well-known/jwks.json`
   (user tokens are ES256), and add JWT Audience **`authenticated`** — without
   it clients fail with `[PSYNC_S2105] Unexpected "aud" claim value`.
4. Dashboard → Sync Streams (edition 3 — not legacy bucket_definitions):

   ```yaml
   config:
     edition: 3

   streams:
     user_notes:
       auto_subscribe: true
       query: SELECT id, user_id, title, content, metadata, tags, is_favorite, is_pinned, is_trashed, trashed_at, entity_type, source_app, source_id, source_url, folder_path, is_external, sync_status, structured_fields, related, ai_visibility, created_at, updated_at FROM notes WHERE user_id = auth.user_id()
   ```

## Rules for future schema changes

When a Postgres migration touches a synced table, update all three of:
`src/sync/schema.ts`, the PowerSync sync rules, and (for new tables) the
`powersync` publication + `grant select`. A column missing from any of them
silently does not sync.
