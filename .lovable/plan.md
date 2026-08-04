# Google Drive Scan Inbox

## Assessment

The idea is strong. Phone-scan → Drive folder → Menerio note is a genuinely low-friction capture path, and it reuses almost everything Menerio already does well: PDF OCR (`analyze-media` via Mistral OCR), smart titles, embeddings, people/moment extraction, folder filing. It is the same shape as the existing GitHub sync (per-user connection row + scheduled poll + import), so there is a proven pattern in the codebase to copy.

Feasibility: medium. The only genuinely new piece is per-user Google authorization. Everything downstream (store file, create note, OCR, title, file into a folder) already exists.

Main caveats to accept up front:
- The 20 MB attachment limit applies; larger scans get skipped with a visible error.
- OCR costs AI credits per page, so imports must go through the existing credit check and stop cleanly when the balance is empty.

## How fast can it be?

What the n8n videos show is not push. n8n's Google Drive Trigger ("On changes involving a specific folder") is a **polling** trigger — its default interval is every minute. It feels instant because the poll is frequent and the file is small, not because Drive pushed anything.

Google Drive does support real push: the Drive API `changes.watch` endpoint registers a notification channel that POSTs to a public HTTPS URL whenever anything in the user's Drive changes. The catches are that channels expire (a few hours to a day) and must be renewed, notifications are "something changed" pings rather than payloads (you re-query with a `startPageToken`), and they cover the whole Drive so we filter by parent folder ourselves.

So the design is **push-first with a polling safety net**:
- `gdrive-webhook`: a public edge function (`verify_jwt = false`) registered as the Drive notification channel. It validates the channel token, looks up the connection, and kicks off a sync run for that user. Latency: seconds.
- A short polling cron (every 2 minutes) that only runs for connections whose last webhook is stale or whose channel failed — a backstop, not the main path.
- A channel-renewal job that re-registers watch channels before they expire and records `channel_id`, `channel_token`, `channel_expires_at`, `start_page_token`.

Phase 2 ships polling only (simple, correct); Phase 3 adds the webhook and drops the poll to backstop duty.


## How it works (user view)

1. Settings → Integrations → "Google Drive scans": click Connect, approve Google in a popup.
2. Pick a Drive folder (browsable list) as the watch folder.
3. Choose the target note folder, default `auto-import/`. Both PDFs and images are imported.
4. Drop a scan into the folder and it shows up in Menerio within seconds: attachment stored, text extracted, AI title generated, filed into the chosen folder.
5. The settings panel shows connection health (live / falling back to polling), last sync time, imported count, and a per-file log with errors; a "Sync now" button forces a run.

## Technical design

**Auth** — Google Drive App User Connector (`google_drive`, already enabled in this workspace). Each end user authorizes their own Drive; the Lovable connector gateway handles token refresh, so we never store Google refresh tokens. Scopes: `userinfo.email`, `userinfo.profile`, `drive.readonly` (or `drive.file` if we later want to move/label imported files). The gateway callback `https://connector-gateway.lovable.dev/api/v1/app-users/oauth2/callback` must be registered on the Google OAuth client. The returned per-user connection key is stored server-side, keyed by `auth.uid()` — never in the browser.

**New table `gdrive_connections`** (one row per user):
`user_id` (unique), `connection_key` (server-only), `google_email`, `watch_folder_id`, `watch_folder_name`, `target_note_folder` (default `auto-import`), `sync_enabled`, `last_sync_at`, `last_error`, plus push state: `channel_id`, `channel_token`, `channel_expires_at`, `start_page_token`, `last_webhook_at`. RLS: owner may read/update non-secret columns; `connection_key` and `channel_token` only readable by service_role. Grants for `authenticated` + `service_role` per project convention.

**New table `gdrive_imports`** — dedup + audit: `user_id`, `file_id` (unique per user), `file_name`, `note_id`, `status` (`imported` | `skipped` | `failed`), `error`, `imported_at`.

**New edge functions**
- `gdrive-proxy` (user JWT): actions `store_connection`, `list_folders`, `save_settings`, `disconnect`, `status`. Mirrors `github-proxy` — the secret never leaves the server.
- `gdrive-sync` (user JWT for "Sync now", service-role for cron): for each enabled connection, `GET /drive/v3/files?q='<folderId>' in parents and trashed=false` ordered by `modifiedTime`, filter out `file_id`s already in `gdrive_imports`, then per file:
  1. download via `?alt=media` through the gateway,
  2. upload to the `note-attachments` bucket and insert a `note_attachments` row (reusing existing naming/uniqueness rules),
  3. create the note with `source_app='google_drive'`, `source_id=<fileId>`, `folder_path=<target folder>`, body containing the PDF/image embed,
  4. invoke `analyze-media` (`media_type: pdf|image`) — the existing post-OCR hook already re-triggers `process-note`, which generates the smart title, embeddings, and extraction,
  5. record the row in `gdrive_imports`.
  Guarded by the existing credit `checkBalance`; on 402 the run stops and writes `last_error` instead of looping. Heavy work runs under `EdgeRuntime.waitUntil`, batched (e.g. 10 files per run) so it never times out.

**Cron** — pg_cron every 15 minutes calling `gdrive-sync` with the service-role key, same shape as `github-sync-scheduled`.

**Frontend** — new `src/components/settings/GoogleDriveScans.tsx` modeled on `GitHubSyncSettings.tsx`, registered in the Integrations overview: connect/disconnect, folder picker, target-folder input, toggles, last-sync status, import log, "Sync now".

## Rollout

Phase 1 — connector client setup + `gdrive_connections` / `gdrive_imports` tables + `gdrive-proxy` + settings panel with connect and folder picker.
Phase 2 — `gdrive-sync` import pipeline with manual "Sync now".
Phase 3 — pg_cron schedule, import log UI, error surfacing and credit-aware pausing.

## Open questions

Answering these before Phase 1 avoids rework; defaults in parentheses are what I'll use otherwise.
- Images as well as PDFs from the watch folder? (default: PDFs only, image toggle available)
- One watch folder or several? (default: one, expandable later)
- After import, leave the file in Drive untouched? (default: yes, read-only scope)
