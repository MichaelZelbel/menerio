## Why the Codex page came out broken

I pulled the actual stored page and the two defects map to two distinct bugs in `supabase/functions/wiki-ingest/index.ts` plus the `WIKI_INGEST_PROMPT` in `supabase/functions/_shared/llm-defaults.ts`.

Stored content (excerpt):
```
Codex is an LLM of [[OpenAI]].
...
## Source links
*   90260b06-1bd1-426f-be73-e2fda9f5ad17
```

### Bug 1 — Phantom `[[OpenAI]]` link

- The model produced `[[OpenAI]]` (capitalized).
- `normalizeResult` lowercases slugs only on action `slug` fields, never on inline wikilinks inside `content`/`patch`.
- `extractWikilinks` uses the regex `\[\[([a-z0-9-]+)\]\]` — capital letters don't match, so `[[OpenAI]]` is invisible to the grounding/stripping pass. The link is written verbatim.
- Even if it had been lowercased to `[[openai]]`, the validator only checks "is this slug grounded in the note text?" It does NOT check "does a page with this slug exist, or is one being created in this same run?" So any name mentioned in a note becomes a clickable wikilink to a non-existent page.

### Bug 2 — Note UUID rendered into the page

- `userMessage` is built as: `note_id: ${noteId}\n\n# ${title}\n\n${contentText}`. The note's UUID is literally in the prompt.
- `WIKI_INGEST_PROMPT` then says: *"For every page you create or update, include the note_id in source_links."* The model conflated the JSON field `source_links` with a markdown `## Source links` section and pasted the UUID into the page body.
- Nothing on the validation side strips UUIDs from `content`/`patch`.
- The display you saw ("90260b06 1bd1 426f be73 e2fda9f5ad17" with spaces) is just markdown rendering — bare UUIDs hit the autolinker / heading slugifier on the Lexicon page and dashes become word separators.

## Fix plan

All changes in `supabase/functions/wiki-ingest/index.ts` and `supabase/functions/_shared/llm-defaults.ts`. No DB migration. No frontend changes. One-time cleanup of already-corrupted pages handled by re-running existing `wiki-cleanup` on affected pages (no code change needed).

### 1. Normalize and validate inline wikilinks properly

In `validateAction` (and a small helper):
- Change the wikilink regex to be case-insensitive: `/\[\[([A-Za-z0-9][A-Za-z0-9 _-]*)\]\]/g`. Capture both the original token and a normalized lowercased-kebab slug.
- Rewrite every wikilink in the produced `content`/`patch` to its normalized lowercase slug before any grounding check, so `[[OpenAI]]` → `[[openai]]` consistently.
- Keep the existing grounding check (slug words must appear in the note).
- Add a second check: the link target must either (a) already exist in `existingBySlug`, or (b) be the slug of another action in the same batch (`acceptedSlugs` built up across iterations / a pre-pass over `parsed.actions`). If neither, replace `[[slug]]` with plain text (the slug words) — same fallback we already use for ungrounded links.
- Reorder so the pre-pass builds `plannedSlugs = existingBySlug ∪ all action.slug` before per-action validation.

### 2. Strip UUIDs and "Source links" sections from generated page content

In a new `sanitizeGeneratedContent(text)` helper called from `validateAction`:
- Remove any UUID v4 substring matching `/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi`.
- Remove any heading block whose title matches `/^##\s*(source[\s-]?links?|note[_\s-]?id|sources?)\s*$/i` together with its body until the next `##` or EOF. (We never want models writing a "Source links" section — the app renders source links from the `wiki_page_sources` table.)
- If sanitization makes the content empty or shorter than ~80 chars, reject the action with reason `empty_after_sanitize`.

### 3. Stop telling the model to embed the note_id

In `WIKI_INGEST_PROMPT` (`llm-defaults.ts`):
- Replace the line *"For every page you create or update, include the note_id in source_links."* with: *"For every page you create or update, add its slug to `source_links[0].page_slugs`. The note_id is filled in for you — do NOT write the note_id or any UUID anywhere in `content` or `patch`."*
- Add a new rule under "GROUND EVERY CLAIM": *"Do not add a Sources, Source links, References, or Notes section. The app shows source notes automatically."*
- Add a wikilink rule: *"Only link to a slug if it already exists in the index above OR if you are creating it in the same response. Otherwise write the name as plain text."*

### 4. Drop `note_id:` prefix from the user message

In `processIngest`:
- Build `userMessage` as just `# ${title}\n\n${contentText}`. The note_id is still passed through the function arguments and used server-side for `source_links` — the model never needs to see it.

### 5. Logging

- Extend the per-action `validationLog` entries with `stripped_links: number`, `stripped_uuids: number`, `removed_sections: string[]` so we can audit synthesis quality from `wiki_log`.

## Cleanup of existing bad pages

No code change required. After the fix ships, the user can:
1. Open `/lexicon/codex` and click the existing "Rebuild from sources" action (uses `wiki-cleanup` with the stricter `WIKI_CLEANUP_PROMPT`, which already forbids inventing links).
2. Or wait for the next note touching Codex to trigger an update — the new sanitizer will strip the UUID block and dead `[[OpenAI]]` link on next write.

If desired we can add a one-shot admin job that loops `wiki-cleanup` over every page whose content matches a UUID regex or contains a "## Source links" heading — say the word and I'll add it as a follow-up.

## Files to change

- `supabase/functions/wiki-ingest/index.ts` — wikilink normalization + existence check, `sanitizeGeneratedContent`, drop `note_id:` prefix, expand validation log.
- `supabase/functions/_shared/llm-defaults.ts` — `WIKI_INGEST_PROMPT` rule updates.

## Out of scope (intentionally)

- No schema changes.
- No UI changes to `WikiPage.tsx` — the rendering is fine once garbage stops being written.
- `wiki-cleanup` already has the right rules; not touching it.
