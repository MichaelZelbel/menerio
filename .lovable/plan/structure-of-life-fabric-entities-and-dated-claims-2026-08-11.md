# Structure-of-life fabric: entities and dated claims

Adds a flat data layer under the existing product: non-person **entities** (places, organizations, projects, things, pets) and **claims** (dated facts about a person, entity, or the user). People and notes stay the faces of the product; nothing existing is removed or renamed.

## Conflicts and decisions to confirm

1. **`contact_relationships` vs. claims.** Relationships already live in their own table with canonical labels, inverse pairs, a rejection ledger, an evidence requirement trigger and a dedup guard. Duplicating them as claims would fork the truth. Decision: relationships stay where they are; claims only gain `valid_from` / `valid_to` on `contact_relationships`, and the Facts panel excludes `attribute = 'relationship'` (the Relationships section keeps owning it). The MCP `add_claim` tool rejects `attribute = relationship` with a pointer to the relationship path.
2. **`profile_entries` vs. self-claims.** `profile_entries` has heavy machinery (dedup triggers, normalizer, skill guard, canonical schema). Claims with `subject_type = 'self'` will be a *separate, undated-fact-free* store, written only by MCP and manual action, with no sync in either direction (explicitly out of scope). Profile page gets a read-only Facts section only if trivial.
3. **Contact facts today.** `profile_entries` also holds per-contact facts (`contact_id`). Claims for contacts are additive and shown in a separate "Facts (dated)" panel so the two do not fight; no migration of existing rows.
4. **Review queue.** New `suggestion_type` values `add_entity` and `add_claim` slot into the existing type registry in `ReviewQueue.tsx` and the bulk worker; no schema change needed (payload is jsonb).
5. **`moments.person_id` still exists** but notes use `metadata.matched_people`; the new `moment_entities` table mirrors `moment_participants` and does not touch either.
6. **Naming.** Nav label "World" is a single constant so it can be renamed in one place.

## Phase 1 — database (one migration)

- `entities`: id, user_id (default auth.uid()), name, aliases text[], entity_type text, description, tags text[], metadata jsonb, ai_visibility, is_sensitive, timestamps + `handle_updated_at` trigger. GRANTs for authenticated/service_role, RLS `user_id = auth.uid()` for all four verbs.
- `claims`: id, user_id, subject_type check ('self','contact','entity'), subject_id (paired CHECK: null iff self, not null otherwise — copied from `contact_relationships`), attribute, value, value_json, valid_from date, valid_to date, confidence check ('certain','likely','unsure'), source_type check ('note','moment','manual','ai'), source_id, timestamps + trigger. Indexes on (user_id, subject_type, subject_id), (user_id, attribute), (user_id, valid_to). Same GRANT + RLS pattern.
- `moment_entities`: moment_id FK moments on delete cascade, entity_id FK entities on delete cascade, role text, PK (moment_id, entity_id), user_id for RLS.
- Additive columns: `contact_relationships.valid_from/valid_to` (date, null), `collection_items.entity_id` and `collection_items.contact_id` (nullable FKs).
- No deletes anywhere: superseding is `valid_to` assignment, enforced in a shared helper, not by trigger (so manual overlapping history stays possible).

## Phase 2 — UI

- **World section** (`/dashboard/world`, `/dashboard/world/:id`): nav entry after People inside the `people` group. Searchable list, filter chips computed with `select distinct entity_type` from the user's rows. Create/edit dialog: name, type combobox (suggestions + free entry), aliases, description, tags.
- **Entity detail**: header (name, type, aliases, tags); Facts panel (current claims, History toggle for superseded ones greyed with ranges, inline add/edit/"no longer true"); Timeline panel from `moment_entities`; Notes panel matching name/aliases the same way person mentions work.
- **Contact page**: new Facts panel (subject_type 'contact'), plus a "Changed recently" line when a claim started/ended in the last 90 days. Relationship rows render their date range when set; the relationship editor gains optional from/to.
- **TimelinePage**: entity filter alongside the person filter.
- **KnowledgeGraph**: entity nodes added in `get-graph-data`, edged to people via shared moments and claims.
- **ReviewQueue**: `add_entity` and `add_claim` cards with approve/dismiss using the existing interaction and bulk worker.
- Wording audit: no UI string calls people "entities".

## Phase 3 — MCP and pipeline

In `menerio-mcp` (same auth, `ai_visibility`/`is_sensitive` filtering via `_ai_visibility.ts`, extended for the `entity` kind):

- `create_entity`, `search_entities`, `get_entity_context` (entity + current claims + recent moments + mentioning notes)
- `add_claim` — auto-ends the overlapping open claim on the same subject+attribute by setting `valid_to`; never deletes
- `get_claims` with modes `current` | `history` | `changed_since`
- `create_moment_with_ai` extended to link entities via `moment_entities`
- `process-note` emits entity/claim **suggestions** into the review queue only — never direct AI writes

## Technical notes

- Shared claim logic (supersede, current-claim selection, changed-since) lives in `supabase/functions/_shared/claims.ts` with a thin frontend mirror in `src/lib/claims.ts`, so SQL/edge and UI agree.
- New hooks `src/hooks/useEntities.ts` and `src/hooks/useClaims.ts` follow the `usePeople` query-key and invalidation conventions.
- All "current vs. history" filtering is SQL (`valid_to is null or valid_to > current_date`) — no LLM in the read path.
- Tests: claim supersede logic, entity type chips derived from data, relationship date rendering.

## Order of work

1. Migration (Phase 1), then regenerate types.
2. Hooks + World list/detail + contact Facts panel.
3. Timeline/graph/review-queue touches.
4. MCP tools and note-pipeline suggestions.
5. Walk the acceptance checklist end to end in the running app.
