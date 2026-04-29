# Lexicon in Menerio

The Lexicon is Menerio’s synthesized knowledge layer. Notes remain the source of truth, while Lexicon pages turn repeated concepts, people, projects, sources, and groups into stable, navigable knowledge pages.

## Purpose

The Lexicon helps users move from raw notes to durable knowledge:

- Find synthesized pages for recurring topics, people, groups, and concepts.
- Navigate backlinks and source notes behind a page.
- Edit pages manually when the AI synthesis needs correction.
- Review page revisions and roll back changes when needed.

## Routes

- `/lexicon` — Lexicon index grouped by page type.
- `/lexicon/:slug` — Individual Lexicon page.
- `/lexicon/lint` — Lexicon health-check route.
- `/wiki`, `/wiki/:slug`, and `/wiki/lint` redirect to the Lexicon routes for backwards compatibility.

## Pages and Sources

Each Lexicon page stores a slug, title, page type, summary, content, source count, and timestamps. Pages can cite source notes through `wiki_page_sources`, so a user can always open the underlying note that informed a page.

Common page types include:

- `concept`
- `person`
- `group`
- `source`
- `overview`
- `synthesis`

## Links, Backlinks, and Revisions

Lexicon pages support Obsidian-style `[[slug]]` links. Link rows are stored in `wiki_links`, enabling backlinks and missing-link detection.

Every AI or manual edit creates a `wiki_revisions` row with previous content, new content, change type, source note, status, and rollback metadata. This keeps synthesis auditable instead of silently overwriting knowledge.

## Group Integration

Groups can maintain a corresponding Lexicon page. The Group page summarizes purpose, members, relevant notes, and synthesized insights, and links back to the operational Group workspace.

## Notes vs Lexicon

- **Notes** are the raw, user-owned Markdown knowledge base.
- **Lexicon pages** are synthesized, curated views over those notes.
- The system should never replace source notes with AI-generated summaries; it should cite and link back to them.