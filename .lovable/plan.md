# Profiles: one consistent layout, and data that actually makes sense

Two halves of the same problem. The layout half makes every profile read the same way; the data half removes the garbage that makes profiles read like machine output.

---

# Part 1 — Rendering

## What is inconsistent today

Three different renderings exist for the same concept — a field and its value:

- **People profiles** (Identity, Basics, …): one row per entry, small muted label on the baseline, value next to it, row borders. No colon.
- **The user's own profile**: the same data stacked — label on its own line, value below. Different spacing, no colon, plus an always-visible add form at the bottom of every section.
- **Relationships** (both profile types): its own card style — no row borders, rounded hover pills, a bold role, and a colon. The only place a colon appears today.

## What it becomes

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

1. **Relationships renders as a normal section** — same card header (chevron, icon, name, count), same bordered one-row-per-entry list, same hover-revealed edit/delete actions. Names stay clickable links. The add form and relational facts (Wedding date, Anniversary) adopt the same row style.
2. **A colon after every field name**, every section, both profile types. Label keeps the smaller muted treatment; the value stays larger and brighter. The relationship role drops its extra bold so it matches other labels.
3. **The user's profile uses the people-profile section component** — same compact rows, collapse behaviour and hover actions. The category settings that only exist on the user's profile (icon, visibility scope, rename, delete) move into the shared section header menu; nothing is lost.

Bulleted list values (Favorite Characters and similar) keep rendering as bullets under the label.

Also fixed here: the relationships card currently throws `genderByPerson.get is not a function` — the gender lookup is a `Map`, which does not survive the persisted query cache and comes back as a plain object. It becomes a serialisable record read through a helper.

---

# Part 2 — Cleaning up the bad data

Yumei's relationship list is the reference case for everything wrong:

```text
Ex-partner: Alucard Metall   Owner: Naoko          Self: Yumei
Friend: Maria                Owner: Shoko          Partner: michael
Subject of notes: Michael    Roleplay char: Chocola / Vanilla
Friend: Starry               Protector: Melly
```

Each failure mode gets a specific, deterministic rule.

**Pseudo-roles are deleted, not displayed.** `Subject of notes`, `Self`, `Protector`, `Roleplay character`, `Admirer`, `Mentioned with` are not things a person says about another person. Removed everywhere, and permanently refused at write time.

**`Owner` stops existing as a person-to-person role.** `Owner: Naoko` and `Owner: Shoko` are VRChat avatar names — not people, and certainly not owners of Yumei. Two-sided fix:
- *At the source*: an avatar/handle guard in extraction so avatar names, usernames and in-world character names never become contacts or relationship edges.
- *In the data*: existing `Owner` edges are deleted; where the target is a recognised non-person entity it is dropped outright rather than converted into some other role.

**Self-edges are deleted.** `Self: Yumei` on Yumei's own profile is a person related to themselves. "This person is me" belongs to self-recognition, never to the relationship list.

**Unevidenced relationships are removed.** `Friend: Starry` exists because a model inferred friendship from co-occurrence. New rule: an edge requires a note, a moment, or an explicit user action *stating* the relationship. Co-mention alone is never sufficient. Edges with no traceable source are removed; edges whose only support is co-occurrence go to the Review Queue instead of being silently kept.

**Duplicates collapse.** `Partner: michael` and `Partner: Michael` are one edge (case- and whitespace-insensitive, per person and role). Exact duplicate facts inside a category collapse the same way.

**Genuine contradictions go to you, not to a guess.** `Ex-partner` and `Partner` for the same person is a real conflict and becomes a Review Queue item. Multiple partners with *different* people are never treated as a conflict and are left alone.

## Yumei afterwards

```text
Ex-partner: Alucard Metall     (kept — explicitly stated)
Friend: Maria                  (kept — evidenced)
Partner: Michael               (kept, case-merged)
```

with the Ex-partner/Partner overlap surfacing as one conflict item, and everything else gone.

## Presenting what remains sensibly

- Rows sort by closeness, not insertion order: family and partners first, then friends, then professional, then everything else.
- Multiple edges to the same person collapse into one row for that person.
- Every role is displayed in the other person's own gender where known (`Wife: Xihui`), never guessed from a name.

---

# Rollout order

1. Shared row primitive + colon + relationships-as-a-section + the gender-map crash.
2. The user's profile switches to the shared section component.
3. Blocklist and avatar guard extended at the write gate and in extraction prompts.
4. `profile-lint` gains the unevidenced-edge, avatar-target and case-duplicate rules, with contradictions classified as review items.
5. One full-account repair run, reported afterwards with an itemised list of what was removed and why.

# Technical notes

- `CompactCategorySection` becomes the single section renderer for both `ContactProfileTab` and `Profile.tsx`; `CategorySection` retires once its settings panel folds into the compact header dropdown.
- A shared `ProfileRow` primitive holds the `label:` + value layout so the three call sites cannot drift again. The colon is render-time only — no stored label text changes.
- The blocklist in the shared `profile-integrity` core gains `owner` as a person-role; frontend and edge copies stay byte-identical, enforced by the existing mirror test.
- `relationship-genders` returns a serialisable record; lookups go through a helper rather than `Map.get`.
- Cleanup runs through `profile-lint` in repair mode; ambiguous cases become `merge_duplicate_person` / `resolve_relationship_conflict` review items with rollback, matching the existing normalization flow.
