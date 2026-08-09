# One consistent row layout across every profile section

## What is inconsistent today

Three different renderings exist for what is conceptually the same thing — a field and its value:

- **People profiles** (Identity, Basics, …): one row per entry, small muted label on the baseline, value next to it, separated by row borders. No colon.
- **The user's own profile**: the same data stacked instead — label on its own line, value on the line below. Different spacing, no colon, and an always-visible add form at the bottom of every section.
- **Relationships** (both profile types): its own card style — no row borders, rounded hover pills, a bold role, and a colon. This is the one place a colon already appears.

So a colon shows up in exactly one section, and the user's profile does not even match the people profiles it is supposed to mirror.

## What it becomes

One row style, used everywhere:

```text
┌──────────────────────────────────────────┐
│ ▾  Identity                          4   │
├──────────────────────────────────────────┤
│ Full name:   Michael Fischer             │
│ Nickname:    Micha                       │
├──────────────────────────────────────────┤
│ ▾  Relationships                     3   │
├──────────────────────────────────────────┤
│ Wife:        Xihui                       │
│ Friend:      Maria                       │
└──────────────────────────────────────────┘
```

1. **Relationships renders as a normal section.** Same card header (chevron, icon, name, count), same bordered one-row-per-entry list, same hover-revealed edit/delete actions as Identity and Basics. Names stay clickable links to that person. The add form and the relational-facts (Wedding date, Anniversary) rows move into the same row style, so the card stops looking like a foreign widget.

2. **A colon after every field name.** `Full name:` `Nickname:` `Wife:` — one rule, every section, both profile types. The label keeps its smaller, muted treatment; the value stays larger and brighter. The relationships role loses its extra bold so it matches the other labels rather than shouting.

3. **The user's profile uses the people-profile section component.** Stacked label-over-value goes away; the user's profile gets the same compact rows, the same collapse behaviour, the same hover actions. Category settings (icon, visibility scope, rename, delete) that only exist on the user's profile are preserved in the section header menu — nothing is lost, it just moves into the shared component.

Bulleted list values (Favorite Characters and similar) keep rendering as bullets under the label, unchanged.

## Also fixed along the way

The relationships card currently throws `genderByPerson.get is not a function` on load: the gender lookup is a `Map`, and a `Map` does not survive the persisted query cache round-trip, coming back as a plain object. Stored as a plain object with a small accessor so it survives persistence, which also stops the section from blanking out after a reload.

## Technical notes

- `CompactCategorySection` becomes the single section renderer, used by both `ContactProfileTab` and `Profile.tsx`; `CategorySection` is retired once its category-settings panel (scope/icon/rename) is folded into the compact header's dropdown.
- `RelationshipsSection` is restructured to reuse the same header and row markup — a shared `ProfileRow` primitive holds the `label:` + value layout so all three call sites cannot drift again.
- The colon is added at render time only; no stored label text changes.
- `relationship-genders` query returns a serialisable record; lookups go through a helper rather than `Map.get`.
