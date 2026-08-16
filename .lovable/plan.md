# Fix: confusing profile labels and broken multi-value rendering

## What is actually wrong (verified against Yumei's live rows)

Her Identity & Basics rows today:

```text
Nickname          Yumi, Yume, Mimi, Chocola      <- 4 values crammed into one row
Name alias        Yume
Name alias        Mimi
Name alias        Chocola
Name alias        ChocolaJoy
Alternative name  mimi
Alternative name  yumi
Alternative name  yaunderε
Japanese name     Yumei
Brazilian name    Yasmin
Full name         Yumei
Life events       Started working at age 14, moved out at 16
Life history      Started working at age 14, moved out at 16   <- duplicate label pair
```

Three separate defects:

1. **Same fact stored under three different labels.** "Name alias" and "Alternative name" are not in the canonical alias list for `Nickname`, so the write-time canonicalizer let them through as new labels. They are nicknames.
2. **Rendering is inconsistent per surface.** The bulleted-list rule exists (`src/lib/profile-list-labels.ts`) but only `CompactCategorySection` uses it. Pinned chips, the fact-add preview and the export path each print the raw comma string. And even inside the section, four `Name alias` rows render as four separate rows instead of one bulleted list — because grouping is per row, not per label.
3. **Junk values are accepted.** `yaunderε` (mixed Latin/Greek, an encoding-mangled handle) and `ChocolaJoy` (an account name, not a nickname) passed the extractor unchallenged.

## The fix

### 1. One renderer for every profile value (kills defect 2 permanently)

New `src/components/profile/ProfileValue.tsx` — the only place a profile value is ever turned into pixels. It takes `label` + `values[]` and renders a bulleted list for 2+ items, plain text for one. Rewire `CompactCategorySection`, `PinnedHighlights`, `QuickAddFact`'s preview and the profile export to call it. A rendering test asserts every surface bullets a multi-value field, so this cannot regress again.

### 2. Group rows by canonical label

`CompactCategorySection` groups entries by their canonical label before rendering. Four `Name alias` rows plus the comma-packed `Nickname` row collapse into a single `Nickname` block with one bullet per distinct value. Edit/delete/pin stay per underlying row (each bullet keeps its own hover actions), so nothing becomes uneditable.

### 3. Close the label loophole at write time

- Extend the canonical schema (`supabase/functions/_shared/profile-canonical-schema.ts`): `name alias`, `alternative name`, `other name`, `also called`, `goes by online`, `username` variants map onto `Nickname`.
- Localized birth names stay meaningful and are **not** folded into Nickname: `Japanese name` / `Brazilian name` / `Chinese name` canonicalize to `Name (Japanese)`, `Name (Brazilian)` etc. under Identity.
- Add a **label gate**: any label the extractor invents that is not canonical and not an accepted alias no longer writes silently. It is written under the closest canonical label when the mapping is unambiguous, otherwise it goes to the review queue as a `new_profile_label` item for you to accept or reject. This is what stops new confusing labels appearing forever.

### 4. Value-quality guard for name-type fields

A deterministic guard (extends the existing skill-guard pattern) applied to `Nickname` and other name labels:

- reject values mixing scripts mid-word or containing stylized/homoglyph characters (`yaunderε`, `unιkιttყ`) — those route to `Social handle` / `Username` instead of `Nickname`;
- reject values that differ from an existing value only by case or whitespace (`mimi` vs `Mimi`);
- reject values that are a platform account string (contains a service-y suffix, `@`, a URL, or digits) as a nickname.

### 5. Backfill the existing mess

One migration that, for all users:

- relabels `Name alias` / `Alternative name` / `Aka` / `Other name` rows to `Nickname`;
- relabels `Japanese name` / `Brazilian name` to `Name (Japanese)` / `Name (Brazilian)`;
- collapses case-duplicate values, splits comma-packed values on accumulator labels into one row per value;
- removes duplicate label pairs like `Life events` / `Life history` (keeps `Life events`);
- moves stylized/handle-shaped nickname values to `Social handle`.

Values I judge as genuinely wrong for Yumei — `yaunderε` and `ChocolaJoy` — are deleted rather than moved, since neither is a nickname you use.

## Technical notes

- Files: `src/components/profile/ProfileValue.tsx` (new), `src/components/people/profile/CompactCategorySection.tsx`, `src/components/people/profile/PinnedHighlights.tsx`, `src/components/people/profile/QuickAddFact.tsx`, `src/lib/profile-list-labels.ts`, `supabase/functions/_shared/profile-canonical-schema.ts`, `supabase/functions/_shared/profile-name-guard.ts` (new), `supabase/functions/process-note/index.ts`, `supabase/functions/normalize-profile/index.ts`, `src/pages/ReviewQueue.tsx` (new `new_profile_label` type).
- One migration for the backfill above.
- Tests: label canonicalization (alias → `Nickname`), name-value guard (script mixing, case dupes, handle shapes), and rendering tests asserting bulleted output on all four surfaces.

## Verification before I report done

Query Yumei's `profile_entries` after the migration and confirm a single `Nickname` row set with clean values, no `Name alias` / `Alternative name` rows, no `yaunderε` / `ChocolaJoy`; then load her profile in a browser and confirm the Identity section renders one `Nickname` block as a bulleted list.
