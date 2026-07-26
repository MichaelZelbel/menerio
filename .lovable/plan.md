## Problem

The Lexicon page's **Backlinks** section lists one card per `wiki_links` row. If a source page mentions the current page multiple times (e.g., several `[[Apple Health]]` wikilinks in the same article), `wiki_links` contains multiple rows with the same `source_page_id`, so the same source page is rendered repeatedly.

In the screenshot, "Apple Health" appears three times in its own Backlinks list because another page links to it multiple times.

## Goal

Each source Lexicon page should appear at most once in the Backlinks section.

## Proposed change

In `src/pages/WikiPage.tsx`, update the `wiki-backlinks` query so that, after resolving source pages, the returned array is deduplicated by `source_page_id`. The render loop can keep using `source.id` as the React `key`.

### Technical detail

Current code (lines 125-138):
```ts
const { data: links, error } = await supabase
  .from("wiki_links")
  .select("id, source_page_id")
  .or(`target_slug.eq.${slug},target_page_id.eq.${page!.id}`);
// ...
return (links || []).map((link) => ({ ...link, source: sourceMap.get(link.source_page_id) || null }));
```

Replace the return with a deduplicated array, keeping the first occurrence of each `source_page_id`:
```ts
const seen = new Set<string>();
return (links || []).reduce<Backlink[]>((acc, link) => {
  if (!link.source_page_id || seen.has(link.source_page_id)) return acc;
  seen.add(link.source_page_id);
  acc.push({ ...link, source: sourceMap.get(link.source_page_id) || null });
  return acc;
}, []);
```

This is a pure frontend change; no database schema or edge-function changes are required.

## Verification

- Build/typecheck passes.
- A Lexicon page that is linked multiple times from the same source page shows that source only once in Backlinks.
- Pages linked from distinct sources still show each source once.