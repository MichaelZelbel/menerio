

# Fix: Smart Search Not Returning Results

## Root Cause

The `search-notes-semantic` edge function is **missing from `supabase/config.toml`**. Without an entry, it deploys with the default `verify_jwt = true`. Supabase's gateway rejects the request before any code runs, returning a 401. The frontend silently falls back to ILIKE search (or shows no results if the error isn't caught cleanly).

All other edge functions that need in-code auth have `verify_jwt = false` entries in the config.

## Fix

### `supabase/config.toml`

Add one entry:

```toml
[functions.search-notes-semantic]
verify_jwt = false
```

This is the only change needed. The function already validates the JWT in code via `supabase.auth.getUser(token)`.

## Verification

After deploying, semantic search should return vector-matched results instead of silently failing. Many notes already have embeddings (confirmed ~12 of 20 sampled notes have `embedding IS NOT NULL`), so results should appear immediately.

