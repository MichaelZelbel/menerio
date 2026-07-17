# Collection AI Chat

Add the same chat surface we already ship for notes and people to collections. Two contexts:

- **Collection context** — chat scoped to a whole collection (all items + schema + agent instructions).
- **Item context** — chat scoped to a single collection item.

The core challenge you called out — every collection has a different shape — is solvable because each collection already carries **`field_schema`** (typed fields, `link_person`, `link_note`, selects, dates, etc.) and **`agent_instructions`** (produced by `generate_collection_schema`). The chatbot reads those at runtime and treats them as the tool contract, so it works for any user-defined collection without per-collection code.

## What the user sees

- On `CollectionDetail` (whole-collection view): the same right-side chat panel as notes/people. Suggestions like "Add an item from this URL", "Summarize entries added this month", "Find duplicates", "Which items are missing a due date?".
- On a collection item drawer/detail: item-scoped chat. Suggestions like "Fill missing fields from this link", "Update status to done", "Link this to the person Xihui".
- Global FAB already exists — no change needed there; it can pick up collection context from route if we want (optional later).

## Backend — new edge function `collection-chat`

Modeled after `note-chat` (shared read tools, agent loop, credits, MCP). One function handling both scopes via a `mode` field.

Request body:
```
{ collection_id, item_id?: string, messages, timezone }
```

System prompt is assembled at request time from:
- Collection name, icon, description, visibility.
- `agent_instructions` (verbatim — this is exactly what they're for).
- **Rendered schema description**: for each field emit `key (type[, options]) — label` so the model sees the exact contract. Mark the `primary` field and `indexable` fields.
- If `item_id` present: the current item's `data` JSON plus resolved links (person names for `link_person`, note titles for `link_note`).
- User profile digest + awareness context (same helpers used by note-chat).

Read tools (reuse `_shared/read-tools.ts`): semantic search, person lookup, media search, list recent notes. Add two new read tools:
- `list_collection_items(collection_id, limit, filter?)` — returns rows with primary field + a compact projection.
- `get_collection_item(item_id)` — full row + resolved links.

Write tools (new, generic over `field_schema`):
- `create_collection_item(collection_id, data)` — validates `data` against `field_schema` server-side (types, required, select options, link_person UUID existence). Returns created row.
- `update_collection_item(item_id, data)` — partial merge, same validation.
- `delete_collection_item(item_id)` — soft-delete if the table supports it, else hard delete.
- `link_item_to_person(item_id, field_key, person_id)` and `link_item_to_note(item_id, field_key, note_id)` — convenience wrappers when the model already knows target ids.
- `extract_item_from_url(url, collection_id)` — fetches the URL server-side (existing web fetcher / MCP), runs a small structured-output pass that receives the same rendered `field_schema` and returns a `data` object; then feeds it into `create_collection_item`. This directly addresses the "fill from link" use case: the LLM doesn't guess field names, it fills the schema we hand it.

Validation is the linchpin. `_shared/collection-schema.ts` (new) provides:
- `renderSchemaForPrompt(field_schema)` — deterministic string for system prompt.
- `validateItemData(field_schema, data)` — throws structured errors the model can read back and retry.
- `resolveItemLinks(row, field_schema)` — expands `link_person`/`link_note` ids to labels.

All writes go through the atomic credits path (`checkBalance` + `openRouterWithCredits`) and RLS-scoped Supabase client, same pattern as note-chat.

## Frontend

- `src/components/collections/CollectionChatPanel.tsx` — mirrors `NoteChatPanel`, reuses `chat-history` (`contextKey = collection:{id}` or `collection-item:{id}`), `chatMarkdownComponents`, credits refresh events.
- Toggle button on `CollectionDetail` header (Bot icon) and inside the item detail dialog.
- After any `*_collection_item` tool result: refetch the collection items list / current item (dispatch a `menerio:collection-updated` event like notes do).

## Why per-collection differences are OK

The model never sees a hardcoded schema. On every turn we hand it:
1. The declarative `field_schema` (with types, options, primary/indexable flags).
2. The user-authored `agent_instructions` describing capture behavior.
3. Validated tool signatures where the `data` argument is free-form JSON, but the server rejects anything that doesn't match the schema.

That's the same contract `generate_collection_schema` and `process-note` already rely on, so a new collection created tomorrow works with zero code changes.

## Out of scope (can follow later)

- Bulk operations across many items in one call (safer to add after single-item flows settle).
- Chat memory that spans different collections in the same conversation.
- Suggestions engine that surfaces "AI ideas for this collection" without the user asking.

## Files to add/change

- Add: `supabase/functions/collection-chat/index.ts`
- Add: `supabase/functions/_shared/collection-schema.ts`
- Extend: `supabase/functions/_shared/read-tools.ts` (two new read tools)
- Add: `src/components/collections/CollectionChatPanel.tsx`
- Edit: `src/pages/CollectionDetail.tsx` (chat toggle + panel mount)
- Edit: the item detail component under `src/components/collections/` (add chat toggle in item view)
- Edit: `src/lib/chat-history.ts` — extend `NOTE_MODIFYING_TOOLS` equivalent or add `COLLECTION_MODIFYING_TOOLS`
