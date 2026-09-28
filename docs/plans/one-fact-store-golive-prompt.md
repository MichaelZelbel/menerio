# One fact store: the go-live prompt

Status: final (2026-09-29). The code it deploys is on `claude/wonderful-keller-sashcq` and passes: 1,200 unit tests, type check, build, and the live-schema switch harness (42/42).

Paste everything below the line into Claude Code on Michael's machine (X30) or the VPS, in the `menerio` checkout. That session has production access; nothing else is needed from Michael. It runs Parts B and C of `docs/plans/one-fact-store.md` unattended, rolls back by itself if any check fails, and ends with one short message.

---

Run the go-live of Menerio's "one fact store" (docs/plans/one-fact-store.md on `main`, Parts B and C, as changed by section 10). Michael is not available and must not be asked anything. Work until it is done or rolled back, then write him one short message in plain words: "Done: …" or "Rolled back because …, nothing lost".

**Setup.**
- `git fetch origin`. The code is on branch `claude/wonderful-keller-sashcq`, the plan on `main`. Read the plan's sections 5.1, 5.3, 5.4, 5.5 and 10 first.
- You need `SUPABASE_ACCESS_TOKEN`, curl, jq, node and npx. Project ref `tjeapelvjlmbxafsmjef`. Production SQL goes through `scripts/rehearsal/prod-read.sh` (read-only) and `scripts/rehearsal/prod-apply.sh` (writes). Functions deploy with `npx supabase@latest functions deploy <names> --project-ref tjeapelvjlmbxafsmjef --use-api`.
- **Rule 5.1:** never select or print a fact's value, a label, or a person's name. Counts and ids only. Nothing from production goes into git except counts.

**0. Preflight. Change nothing until all of these pass; if one fails, stop and tell Michael why in one sentence.**
1. On the code branch: `npm ci`, `npm test`, `npm run build`, `npx tsc --noEmit -p tsconfig.app.json`. All green.
2. You can push to `main` of `MichaelZelbel/menerio`: that push is what publishes the site. No Lovable and no browser are involved.
3. Record, for the rollback: the deployed version of every edge function this release changes or deletes (the management API lists them), and the current `main` commit of the menerio repo.
4. Apply the teach-it-once-kit patch: in a checkout of `MichaelZelbel/teach-it-once-kit`, `git am <menerio>/docs/plans/patches/teach-it-once-kit-world-pull-paging.patch`, run `tools/test-world-pull.sh`, push to its default branch, and update the kit on this machine (the runner at `~/.local/bin/mc-notebook-sync` uses it).
5. Re-run the A6 trial (`bash scripts/rehearsal/dress-rehearsal-sql.sh > /tmp/r.sql && bash scripts/rehearsal/prod-apply.sh /tmp/r.sql`) after re-running the label map (`select internal.call_edge('build-fact-label-map','{}'::jsonb)`, wait 30 s, check no label or attribute is missing). Expect the `FACT_STORE_REHEARSAL_DONE` error with counts; any other error stops the go-live. The counts must be within 5 % of the last A6 run in `docs/plans/one-fact-store-baseline.md` (the switch now also deletes unshown garbage and resolves two answers; those counts are new, just record them). Confirm `select to_regclass('public.fact_slots')` is null afterwards.

**B. Go live (plan 5.3, in this order).**
- B0. Apply `supabase/migrations/20260929090050_fact_writer_pause.sql` (record it in `supabase_migrations.schema_migrations`). Deploy every changed edge function (list: `git diff --name-only origin/main...claude/wonderful-keller-sashcq -- supabase/functions`, `_shared` users first, `menerio-mcp` last) and the new `split-legacy-bags`. The pause flag is still off, so nothing changes yet.
- B1. `update maintenance_flags set is_on = true, changed_at = now() where key = 'fact_writes_paused'`. Pause crons 4, 9, 11, 12, 15, 16, 18 (`cron.alter_job(id, active := false)`). If this machine hosts the hourly Godspeed runner, pause it. Run `supabase/rollback/fact_store_backup.sql` (snapshot counts must equal live counts).
- B2. Apply `…090100_fact_store_schema.sql`, record it. Check that `profile_facts` answers as the `authenticated` role.
- B5. Re-run the label map, then apply `…090200_fact_store_switch.sql` in one transaction, record it. If it raises, nothing changed: fix the cause only if it is obvious and in your power, retry once, else roll back.
- B4. Merge `claude/wonderful-keller-sashcq` into `main` (a merge commit; the pull request if one exists) and push. That publishes the site.
- B6. `select internal.call_edge('split-legacy-bags','{}'::jsonb)`, wait for it, read its counts from the function logs (a bag a human typed, or one with a piece that cannot be filed, is left as it is). Apply `…090300_fact_store_cleanup.sql`, record it. Delete crons 4, 15, 16 and the functions `promote-profile-entries`, `profile-audit`, `admin-normalize`, `build-fact-label-map`, `split-legacy-bags`. Add the `backfill-claim-embeddings` cron every 10 minutes through `internal.call_edge` and run it once. Resume crons 9, 11, 12, 18. Set the pause flag off. Resume the Godspeed runner. Update `docs/CRON_JOBS.md` (names and schedules only).

**C. Test live (plan 5.5, with section 10's changes).** Every check is automatic.
1. Database invariants from 5.5 step 1, plus: no current fact shows two answers.
2. Through the Menerio MCP tools: `get_user_profile`; `get_contact_profile` and `get_claims` for one normal contact, one with a private section, one hidden (pick them by id with counts-only queries): each fact once, nothing private or hidden. Five `search_brain` questions answer. `add_claim` on a throwaway test account: refused without a quote, accepted with one, a repeat is a no-op.
3. Note pipeline: create a note on the test account; its facts arrive as claims with origin `ai_note`, a quote and a slot.
4. The page's actions: `SUPABASE_URL=… SUPABASE_ANON_KEY=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/golive/page-walkthrough.mjs` (read the keys through the management API; never print or commit them). It creates and deletes its own test user and performs every page action through the page's own calls, checking the rows after each one. No browser.
5. Merge two test contacts that share a fact: one fact remains, no suppression row was written.
6. Godspeed: run the kit's pull with `--dry-run`: removals ≈ the A6 Godspeed removal count plus the replaced bag files. Then run it for real and `git diff --stat world/claims` in the godspeed checkout. Merge branch `claude/one-fact-store` into `main` in `MichaelZelbel/godspeed-engine` and `MichaelZelbel/godspeed`.
7. Edge function logs since B1: no new errors, none mentioning `profile_entries`.
8. Write the counts (numbers only) into `docs/plans/one-fact-store-baseline.md` and mark the plan's status "live" on `main`; push.

**If any check in B or C fails** and the cause is not a small fix you can make, test and deploy on the spot: run `supabase/rollback/fact_store_rollback.sql` (plan 5.4), redeploy the recorded function versions, revert the merge commit on `main` and push (that republishes the previous site), resume the jobs, turn the pause flag off, and check the rollback's own assertions. Then tell Michael in one sentence what failed; his data is back as it was, and nothing he typed is lost (`fact_backup.dropped_by_rollback` keeps anything written in between).

**Delete the test account and its data at the end,** whatever the outcome.
