

# Automatic Handshake: Querino ↔ Menerio Connection Verification

## Concept

The current flow creates a `connected_apps` row the moment the user clicks "Connect." Instead, we keep that behavior (the row is created with a new status field), but the app shows as **"Waiting for handshake"** until Querino actually verifies the key. Once Querino pastes the key and calls a new `verify-connection` endpoint on Menerio, both sides confirm the link and show "Connected."

## Flow

```text
Menerio                              Querino
───────                              ───────
1. User clicks "Connect Querino"
2. Key generated, row inserted
   with connection_status = 'pending'
3. User copies key
4. User pastes key in Querino settings
                                     5. Querino calls POST /verify-connection
                                        with x-api-key header
6. Menerio validates key,
   updates connection_status = 'active'
7. Returns { ok: true, app: "menerio" }
                                     8. Querino marks its side as connected
9. Menerio UI polls/refetches,
   shows "Connected" ✓
```

## Changes

### 1. Database migration: Add `connection_status` column to `connected_apps`

Add a new column `connection_status` (text, default `'pending'`) with allowed values: `pending`, `active`, `revoked`. The existing `is_active` column controls pause/unpause; `connection_status` tracks whether the handshake completed.

### 2. New edge function: `verify-connection`

**File: `supabase/functions/verify-connection/index.ts`**

- Accepts POST with `x-api-key` header (same as `receive-note`)
- Looks up the key in `connected_apps`
- If found and `connection_status` is `pending`: updates to `active`, returns `{ ok: true, app_name: "menerio", user_display_name: <profile display_name> }`
- If already `active`: returns `{ ok: true, already_connected: true }`
- If not found or revoked: returns 401
- This is the "handshake" endpoint Querino calls immediately after the user pastes the key

### 3. Update `AppIntegrations.tsx` UI

- Show three visual states based on `connection_status`:
  - `pending` → amber badge "Awaiting handshake" with a hint ("Paste the key in Querino to complete setup")
  - `active` → green badge "Connected" (current behavior for `is_active`)
  - Not connected → "Connect" button (current behavior)
- Add `refetchInterval: 5000` to the query so it auto-refreshes while any app is in `pending` state (stops polling once all are `active` or disconnected)
- The existing "Paused" badge remains for `is_active === false` on an `active` connection

### 4. Update `receive-note` to also accept `pending` connections

Currently `receive-note` checks `is_active`. It should also allow `connection_status = 'pending'` keys — the first successful `receive-note` call could also upgrade `pending` → `active` as a fallback handshake path (so even if `verify-connection` isn't called explicitly, the first real sync completes the handshake).

### 5. Querino-side context (for when you work on Querino)

Querino needs to call `POST https://tjeapelvjlmbxafsmjef.supabase.co/functions/v1/verify-connection` with the `x-api-key` header when the user saves their Menerio key. If the response is `{ ok: true }`, Querino marks its integration as connected. This is a Querino change, noted here for reference.

## Summary

No user-facing "webhook URL" fields. No manual "I'm connected" toggles. The user clicks Connect in Menerio, copies a key, pastes it in Querino, and both apps automatically confirm the link. Three files touched in Menerio: one migration, one new edge function, one UI component update.

