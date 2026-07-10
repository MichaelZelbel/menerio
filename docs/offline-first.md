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

- Per device (works on production, no rebuild):
  `localStorage.setItem("menerio:offline-core", "true"); location.reload()`
- Globally: build with `VITE_OFFLINE_CORE=true`, or flip the default in
  `src/lib/flags.ts` once sync is verified.

Without a PowerSync endpoint configured the local database still works fully
offline (writes queue locally); background sync just stays off.

## Provisioning the PowerSync Cloud instance (one-time)

1. Create an account/instance at <https://accounts.journeyapps.com/portal/powersync-signup>
   (free tier). Choose a region near the Supabase project (eu-central).
2. In Supabase (project `tjeapelvjlmbxafsmjef`) → SQL editor, create the
   replication role (generate a strong password; store it only in PowerSync):

   ```sql
   create role powersync_role with replication login password '<generated>';
   grant select on public.notes to powersync_role;
   ```

   The `powersync` publication already exists via migration. When new tables
   join the subset: `alter publication powersync add table public.<t>;` plus
   `grant select`.
3. In the PowerSync dashboard, connect the instance to Supabase using the
   direct connection string with `powersync_role`, and enable "Supabase auth"
   (JWT validation via the project's JWT secret / JWKS).
4. Deploy sync rules:

   ```yaml
   bucket_definitions:
     user_notes:
       parameters: select request.user_id() as user_id
       data:
         - select id, user_id, title, content, metadata, tags, is_favorite,
                  is_pinned, is_trashed, trashed_at, entity_type, source_app,
                  source_id, source_url, folder_path, is_external, sync_status,
                  structured_fields, related, ai_visibility, created_at, updated_at
           from notes
           where user_id = bucket.user_id
   ```

5. Put the instance URL into `src/sync/config.ts` (`POWERSYNC_URL`), or test a
   single device first via
   `localStorage.setItem("menerio:powersync-url", "https://<id>.powersync.journeyapps.com")`.
6. Verify: sign in on two browsers with the flag on, edit a note offline in
   one, reconnect, watch it appear in the other and in Postgres.

## Rules for future schema changes

When a Postgres migration touches a synced table, update all three of:
`src/sync/schema.ts`, the PowerSync sync rules, and (for new tables) the
`powersync` publication + `grant select`. A column missing from any of them
silently does not sync.
