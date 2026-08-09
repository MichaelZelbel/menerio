# Why your profile shows people you have no relationship with

## What I actually checked this time

I read your 18 stored relationship rows and the table definition before writing this. Three concrete facts:

1. **Every one of your 18 relationship rows has no evidence attached, and every one claims `origin = 'user'`.** The reason is a single line in the table definition: `origin` has the default value `'user'`. The evidence gate only demands a source quote when `origin` is *not* `'user'` — so any AI writer that simply does not set the column is silently recorded as "the user typed this by hand" and skips the gate entirely. That is why `friend: Shoko` and `manager: Gunther Reinhard` are on your profile: nothing wrote them with your consent, and nothing can now tell them apart from rows you really did enter.

2. **The duplicate pairs are a key-matching bug, not a data bug.** You have `Jürgen -> stepfather -> me` and `me -> stepson -> Jürgen`. The collapse key inverts `stepfather` to `stepchild` and `stepson` to `stepparent` — two different strings — so the two halves of one bond never match and both render. Same for `me -> son -> Brigitte` / `Brigitte -> mother -> me`, which is why you see both `mother: Brigitte` and `parent: Brigitte`.

3. **`manager: Gunther Reinhard` is classified professional and still rendered in the same list** as your mother and your wife, with no separation, so a work reporting line reads as a personal relationship.

## Why my previous "done" claims were worthless

I verified against the database and unit tests, never against the rendered rows, and the database looked fine because bad rows were wearing an `origin = 'user'` badge. I also never asked the obvious human question — *does this person belong on this list at all* — which is the only question that mattered. Fixed below by making the check operate on your real 18 rows and print them.

## What gets built

### 1. Kill the provenance loophole
- Drop the `'user'` default on `origin`. Every writer must state who it is; a row with no stated origin is rejected outright.
- The profile UI form stamps `origin = 'user_manual'`. Everything else (`ai_note`, `ai_moment`, `ai_lexicon`, `import`, `review_queue`) is required by the trigger to carry a source quote and a note id.
- Backfill: all 18 existing rows become `origin = 'unverified'`, because none of them can honestly claim you entered them.

### 2. Confirm-or-drop pass over the existing 18
Unverified rows do not silently disappear and do not silently stay. The Relationships card shows them dimmed with an "Unconfirmed" marker and a single **Review relationships** action that walks you through all of them in one pass — Keep / Remove / Fix the label — and for each one shows the note it most likely came from, if any can be found. After the pass, unconfirmed rows are gone from the profile; only confirmed ones remain.

### 3. Fix the collapse so one bond is one row
Pair keys normalise family roles to a neutral family term on both sides (`stepfather`/`stepson`/`stepparent`/`stepchild` all key to one step-parent bond; `son`/`mother`/`parent`/`child` to one parent bond) before comparing. Result on your profile: Jürgen once, Brigitte once, rendered from your point of view (`Stepfather: Jürgen Skoppek`, `Mother: Brigitte`).

### 4. Separate professional from personal
Work roles (`manager`, `colleague`, `client`, `advisor`) render under their own **Work & professional** subheading inside the card, never mixed into family and friends, and are excluded from the relationship-status summary.

### 5. Duplicate contacts that pollute both sides
`Xihui -> spouse -> michael` and `Yumei -> partner -> michael` point at a contact record named `michael` that is you. Those get re-pointed to `self` and de-duplicated against the rows you already have, so your wife's profile stops listing a stranger who is you.

### 6. The check I run before saying anything is done
A render test that feeds the component your **actual 18 production rows** and prints the resulting lines. It fails if any line is unevidenced-and-unconfirmed, any person appears twice, any professional role sits in the personal list, or any line reads in the inverse direction. I paste the printed lines in my reply. If a line looks wrong to a human, it is not done.

Note on live verification: this project is on an external Supabase, so the preview sign-in cannot inject a session for me — I cannot log into your account myself. The render test above uses your real rows, which is the closest honest substitute. If you would rather I drive the real UI, a throwaway test account with the same fixtures works and I will screenshot it.

## Technical notes

- Migration: `ALTER TABLE contact_relationships ALTER COLUMN origin DROP DEFAULT`; update `relationship_require_evidence()` to accept only `user_manual` as gate-exempt and to reject `NULL`/unknown origins; backfill existing rows to `unverified`.
- `src/lib/relationship-canonical.ts`: add `familyBondKey()` used by `relationshipPairKey` so gendered and neutral kin terms share one key; `inverseLabel` stays as-is for display.
- `src/components/people/RelationshipsSection.tsx`: professional subheading, unconfirmed styling, review-pass entry point.
- `src/hooks/useContactRelationships.ts`: stamp `origin: 'user_manual'` on manual writes.
- New `src/components/people/__tests__/relationship-render.test.tsx` holding the 18-row fixture snapshot, plus `scripts/audit-relationships.ts` extended with the confirmed/professional/duplicate assertions.
