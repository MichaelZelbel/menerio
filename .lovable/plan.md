## Goal

Make the Knowledge Graph **honest** about why two notes connect. Today, "About Lucy" and "Love & Relationships Strategy" are linked by a direct edge because both mention Xihui — but the edge gives no hint of *why*, suggesting Lucy is somehow related to relationship strategy. Fix this by (1) routing shared-person edges *through the actual person node*, and (2) labeling every edge with its reason in the side panel and tooltip.

## Plan

### 1. Route `shared_person` edges through the person node

In `get-graph-data`, when assembling the graph:

- For every `shared_person` connection between note A and note B that resolves to a canonical person P (already done via the alias map), **do not** emit a direct A↔B edge.
- Instead, ensure person P exists as a node in the graph (insert it if missing, typed `person_note` — use the contact's profile note if one exists, otherwise synthesize a lightweight person node from the contact row).
- Emit two edges: A↔P and B↔P, both typed `mentions_person`, strength derived from the original connection. Deduplicate so the same A↔P edge isn't added once per co-mentioned note.

Visual result: Lucy's note connects to a **Xihui** node, and the Relationships Strategy note also connects to that **Xihui** node. The misleading direct Lucy↔Strategy edge disappears, replaced by the truthful two-hop path Lucy → Xihui → Strategy.

### 2. Down-weight shared-person edges when the person is incidental

Heuristic applied in `compute-connections` (or in the routing step above):

- If the shared person is **not in either note's title** and is only one of ≥3 people mentioned in that note, treat the mention as incidental and use strength 0.4 instead of 0.7.
- If the person is in the title or is the only person mentioned, keep strength 0.7+.

This stops a tangentially-mentioned person from creating thick, visually dominant edges.

### 3. Label every edge with its reason

In `KnowledgeGraph.tsx` side panel and hover tooltip:

- For `shared_person` / `mentions_person` edges show: **"via {Person Name}"**.
- For `shared_topic` show: **"shared topic: {topic1, topic2}"** (from `edge.metadata.topics`, already populated).
- For `semantic` show: **"similar content ({similarity}%)"**.
- For `wikilink` / `manual_link` keep existing labels.

Add a small inline label on edge hover (using existing Radix `Tooltip` on the SVG/canvas edge layer), and include the same line in the edge details section of the side panel when an edge is selected.

### 4. Side panel: "Mentioned in N notes" for person nodes

When a person node is selected, list the notes connecting to them (already available from the routed edges). Lets the user immediately verify the connection makes sense ("Xihui is mentioned in: About Lucy, Relationships Strategy, Rome Itinerary, …").

## Technical details

Files touched:

- `supabase/functions/get-graph-data/index.ts` — pivot `shared_person` edges through person nodes, ensure person node insertion, emit `mentions_person` edges, attach `metadata.via_person_name` and `metadata.via_person_id`.
- `supabase/functions/compute-connections/index.ts` — apply the incidental-mention down-weight; persist the shared person ID in `metadata.shared_person_id` so `get-graph-data` can pivot without re-resolving aliases.
- `supabase/functions/recompute-all-connections/index.ts` — same down-weight (uses the same shared helpers).
- `src/pages/KnowledgeGraph.tsx` + relevant graph render component — edge hover tooltip, reason line in side panel, "Mentioned in N notes" list for person nodes.
- No new edge function, no DB migration. After deploy the user just clicks **Rebuild** again.

## What this will visibly fix

- The direct **About Lucy ↔ Love & Relationships Strategy** edge disappears.
- Both notes connect to a central **Xihui** person node instead — making it obvious the only link is "they both mention Xihui".
- Hovering any remaining edge shows *why* it exists ("via Xihui", "shared topic: travel, rome", "similar content 78%").
- Incidental mentions produce thinner, lower-strength edges instead of thick 0.7 ones.
