# Stop guessing: give me eyes on the app, then fix what the screen shows

## Why the last attempts failed

I checked your live data and the shipped code before writing this, and the mismatch is the whole story:

- Your own profile now has 9 relationship rows in the database — Jürgen (stepfather), Brigitte (mother), Xihui, Lena, Yumei, Shoko, Gunther (manager). The junk rows (`author: Nate Jones`, `financial advisor`) are gone from the table.
- I ran those exact rows through the shipped rendering code. It outputs, correctly collapsed and from your point of view: `Stepfather: Jürgen Skoppek`, `Mother: Brigitte`, `Wife: Xihui`, `Girlfriend: Lena`, `Girlfriend: Yumei`, `Friend: Shoko`, and `Manager: Gunther` in a separate professional block.

So my checks pass while your screen is wrong. That gap has one cause: **I have never once seen this app rendered.** This project runs on an external Supabase, so the platform cannot inject a preview session for me — my browser tooling lands on the login wall and stops. Every "done" I gave you was a database query or a unit test, never the page. That is the bug in my process, and it is the first thing this plan fixes.

I also found one concrete defect that a screenshot would have caught immediately and my DB checks structurally could not: on **your** profile page the relationships are rendered **twice** — once by the new Relationships section, and again as a plain `Relationships & Family` category further down (`Online girlfriend: Yumei`, `Wedding date`). Contact profiles filter that category out; your own profile does not. That alone makes the page read as the old, ambiguous, duplicated mess.

## Step 1 — Build the eyes (before touching any relationship code)

1. A dedicated, admin-only edge function that provisions a **seeded test account** in your Supabase: confirmed email, throwaway address, and a fixture set of people and relationships that reproduces the exact ugliness you reported (bidirectional pairs, parenthetical names like `Jürgen Skoppek (Stiefvater)`, junk roles, duplicate contacts). Credentials go into project secrets, never into chat or code.
2. A Playwright script, `scripts/verify-profile-render.ts`, that logs into the preview as that account, navigates to `/dashboard/profile` and to two contact profiles, and captures screenshots plus the literal text of every rendered relationship line.
3. From this point on, **no report of success without the screenshot attached.** If I cannot produce the image, the answer is "not done".

## Step 2 — Fix what the screenshots show

Known already, and fixed in this step:

- Remove the duplicated relationship surface from your own profile: the `Relationships & Family` category is folded into the Relationships section (as milestones) exactly the way contact profiles already do it, so a profile has one relationship surface, never two.
- Migrate the leftover relationship-shaped facts in that category (`Online girlfriend: Yumei`) into real relationship rows, and delete the fact copies so nothing is stated twice.
- Drop the gender guess: `partner` currently renders as `Girlfriend` even when gender is unknown. Unknown gender renders the neutral term (`Partner`).

Everything else in this step is driven by what the screenshots actually show, not by what I assume.

## Step 3 — Re-run the same verification and show you the result

I re-run `verify-profile-render.ts` and paste the captured lines and the screenshot. The check fails loudly if any rendered line: is duplicated for the same person, contains a parenthetical role in a name, uses a role outside the closed vocabulary, or reads in the inverse direction. Only a clean run is reported as done.

## What I need from you: nothing

No screenshots, no pasting, no telling me where the bug is. If provisioning the test account hits a wall in your Supabase (email confirmation policy, for example), I will say so plainly in one line and tell you the single setting that unblocks it — I will not hand the debugging back to you.

## Technical notes

- Test-account provisioning: new `supabase/functions/admin-seed-test-user`, service-role `auth.admin.createUser` with `email_confirm: true`, guarded by an admin role check; fixtures written under that user's id only.
- Verification harness: Playwright against `http://localhost:8080`, credentials read from env, screenshots to `/tmp/browser/`; assertions on the rendered text nodes of the relationships section.
- Duplicate surface: `src/pages/Profile.tsx` must apply the same `relationships` category filter and `milestones` pass-through that `src/components/people/ContactProfileTab.tsx` already does.
- Neutral gender: `displayRole` in `src/lib/relationship-canonical.ts` returns the neutral term when gender is `unknown` instead of defaulting to the gendered one.
- Data move: one-off migration converting `relationships`-category profile entries that name a person into `contact_relationships` rows with `origin: 'user'`, then deleting the fact rows.
