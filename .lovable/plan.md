# Stop misclassifying projects (Menerio, Querino, …) as people

## What's happening today

In `supabase/functions/process-note/index.ts`, the metadata LLM returns a `people` array. For each name not already in `contacts`, we push an `add_contact` review item ("Add X to your People"). The check is contacts-only — it never asks whether the same name already exists in the **Lexicon** (`wiki_pages`) as a non-person concept.

That's why your Linktree note produced both:
- ✅ Lexicon entries: `Lovable`, `Querino`, `Menerio` (correct — created by `wiki-ingest`)
- ❌ Review items: *Add "Menerio" to your People*, *Add "Querino" to your People*

The two pipelines (`wiki-ingest` and `generateReviewItems`) don't talk to each other.

## Fix (two complementary layers)

### 1. Lexicon-aware suppression (deterministic, primary fix)

In `generateReviewItems` (around line 788), before suggesting `add_contact` or `add_alias` for a name, look it up in `wiki_pages` for the same user:

```ts
const { data: lexiconPages } = await supabase
  .from("wiki_pages")
  .select("title, slug, aliases")
  .eq("user_id", userId);

const lexiconNames = new Set<string>();
for (const p of lexiconPages ?? []) {
  if (p.title) lexiconNames.add(p.title.toLowerCase());
  if (p.slug)  lexiconNames.add(String(p.slug).toLowerCase().replace(/-/g, " "));
  if (Array.isArray(p.aliases)) p.aliases.forEach((a: string) => a && lexiconNames.add(a.toLowerCase()));
}

// inside the per-person loop, right after the contacts/blocklist checks:
if (lexiconNames.has(person.toLowerCase())) {
  console.log(`Skipping "${person}" — already a Lexicon entry (not a person)`);
  continue;
}
```

Effect: any name that is (or becomes) a Lexicon concept is treated as "known non-person" and never produces a People suggestion. This is order-independent because `wiki-ingest` runs as part of the same note pipeline; even when `wiki-ingest` lands milliseconds later, the next note containing the same name will be filtered, and we'll also handle the race below.

### 2. Same-note race protection

`generateReviewItems` and `wiki-ingest` can run concurrently. To handle the first note that introduces a name, also exclude any name the current note's metadata flagged for Lexicon creation. We piggyback on the wiki ingest plan if available in `metadata` (or read `wiki_pages` filtered by `note_id` via `wiki_page_sources`). Concretely:

```ts
const { data: thisNotePages } = await supabase
  .from("wiki_page_sources")
  .select("wiki_pages(title, aliases)")
  .eq("user_id", userId)
  .eq("note_id", noteId);
thisNotePages?.forEach((row: any) => {
  const wp = row.wiki_pages;
  if (wp?.title) lexiconNames.add(wp.title.toLowerCase());
  if (Array.isArray(wp?.aliases)) wp.aliases.forEach((a: string) => lexiconNames.add(a.toLowerCase()));
});
```

If `wiki-ingest` hasn't finished yet for the very first note, the review item is still created but will be auto-suppressed on the next pass; we'll also retro-clean (see step 4).

### 3. Tighten the extractor prompt

In `METADATA_SYSTEM_PROMPT` (line 535), make "people" unambiguous:

> `"people": array of names of actual human beings mentioned (real individuals — first name, full name, or known alias). Do NOT include companies, products, apps, projects, tools, websites, brands, open-source repos, or any non-human entity, even if the name looks like a personal name.`

This stops the LLM from emitting `Menerio` / `Querino` as people in the first place for most notes.

### 4. Clean up the existing bad suggestions

One-shot migration / SQL via `supabase--read_query` first, then a delete: dismiss any `pending_review` `add_contact` row whose `extracted_value` (case-insensitive) matches an existing `wiki_pages.title` or alias for the same user. Status → `dismissed`, reason: `auto_dismissed_lexicon_match`. This fixes the two items currently shown in your Review Queue and any historical equivalents.

## Out of scope

- No changes to `wiki-ingest`, contacts schema, or the Review Queue UI.
- People→Lexicon promotion (when a contact turns out to be a project) is a separate, larger feature.

## Files touched

- `supabase/functions/process-note/index.ts` — prompt tweak + lexicon suppression in `generateReviewItems`.
- One SQL migration to dismiss already-created bogus `add_contact` suggestions.
