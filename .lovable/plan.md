

# Beta Readiness: Querino → Menerio One-Way Sync

## Current State

The integration is **almost fully built** across both projects. Querino has complete sync infrastructure (queue, rendering, UI). Menerio has the `receive-note` endpoint and full external note display. The gap is small but critical.

## What's Missing (Menerio side only)

### 1. Register `receive-note` in `supabase/config.toml`

The edge function file exists but is **not registered** in `config.toml`, so it won't deploy. Add:

```toml
[functions.receive-note]
verify_jwt = false
```

Also register `send-patch` and `patch-response` if you want the full bidirectional flow later:

```toml
[functions.send-patch]
verify_jwt = false

[functions.patch-response]
verify_jwt = false
```

### 2. Add a unique index for upsert deduplication

The `receive-note` function does manual SELECT-then-INSERT/UPDATE to upsert by `(user_id, source_app, source_id)`. This works but is not race-safe. Add a unique index:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_notes_source_dedup
ON notes (user_id, source_app, source_id)
WHERE source_app IS NOT NULL AND source_id IS NOT NULL;
```

This also enables switching to a proper `ON CONFLICT` upsert later.

### 3. Trigger `process-note` after receiving external notes

Currently `receive-note` creates the note but does **not** trigger embedding generation or metadata extraction. The `hub-api-notes` POST endpoint does this. Add a background call to `process-note` after insert/update in `receive-note`:

```typescript
// After successful insert or update:
fetch(`${SUPABASE_URL}/functions/v1/process-note`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ noteId: noteId, userId }),
}).catch(() => {});
```

This ensures external notes get embeddings and appear in semantic search and the knowledge graph.

### 4. Set up a `connected_apps` entry for Querino

The user needs a way to create a connected app entry for Querino. The `ConnectionsManager` component in Settings already provides this UI (separate from the Hub API Keys system). The user:
1. Goes to Settings → Connections
2. Creates a new app called "Querino" 
3. Copies the generated API key
4. Pastes it into Querino's Menerio integration settings

No code change needed — just user action.

## What Does NOT Need to Change

- **Querino**: Fully implemented. `render-for-menerio`, `process-menerio-sync-queue`, sync queue, bulk sync UI, per-artifact sync buttons — all done.
- **Menerio `receive-note`**: Logic is correct — validates `x-api-key`, checks `connected_apps`, upserts notes with `is_external: true`, `source_app`, `source_id`.
- **Menerio note display**: `ExternalNotePanel`, `NoteEditor` read-only mode for external notes, `NoteList` source_app badge — all working.
- **Menerio `send-patch` / `patch-response`**: Already built for future bidirectional sync.

## Summary of Changes

| Change | File | Effort |
|--------|------|--------|
| Register `receive-note` in config | `supabase/config.toml` | 1 line |
| Register `send-patch` + `patch-response` | `supabase/config.toml` | 2 lines |
| Add source dedup index | New migration | 3 lines SQL |
| Add `process-note` trigger in `receive-note` | `supabase/functions/receive-note/index.ts` | ~10 lines |

Total: ~15 lines of code changes. Everything else is already built.

## Technical Detail

The two auth systems coexist intentionally:
- **Connected Apps** (`x-api-key` + `connected_apps` table): Used by spoke apps like Querino for note push/sync. Plaintext key, simple.
- **Hub API Keys** (`Bearer mnr_...` + `hub_api_keys` table): Used by external integrations needing scoped REST access (profile, notes, contacts, etc.). SHA-256 hashed, scoped.

Querino uses the Connected Apps system, which is correct for its use case.

