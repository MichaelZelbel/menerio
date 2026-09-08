# Menerio code review and repair plan

Reviewed on 8 September 2026 against `811f75ecd5c067d203d624d9d48b7ac2a5f3b997` from `origin/main`.

Six findings warrant fixes. Address sharing permissions, account cache isolation, and contact merge safety first. Four failures were reproduced locally using actual application code with synthetic service responses. Two findings follow from the checked-in database and query definitions. Production exposure and production data loss are **UNVERIFIED**; no live accounts or records were tested or changed.

## Scope and extent

The local checkout was clean. Switched from `codex/person-conversation-topics` to `main` and pulled the latest main with a fast-forward, bringing in 13 commits. Created `codex/code-review-20260908` for this report and the diagnostic script.

Mapped the React application, authentication and cache boundaries, PowerSync upload path, server functions, database migrations, and CI checks. Read selected high-risk flows in detail: note sharing, account changes, contact merging, contact queries, GitHub synchronization, account deletion, and administrator notifications. Traced related migration definitions and existing tests before retaining findings.

The inventory contains 394 frontend TypeScript files, 181 server TypeScript files, and 197 migration files. This was a targeted source review with automated checks, not a line-by-line audit of all those files. The syntax/import check covers all 181 server files; it does not typecheck them.

No application fixes, database migrations, production deployments, or live permission probes were performed. No browser acceptance run, real PostgreSQL permission test, full migration replay, dependency vulnerability audit, or full Deno typecheck was performed. Those limits are intentional boundaries of the evidence, not assurances that unreviewed areas are safe.

## Verification results

Executed locally with Node 22.19.0 and npm 10.9.3 using the existing dependency installation. `npm ls --depth=0` returned exit 0. A fresh `npm ci` was not performed; CI uses Node 20, so that exact clean-install environment remains unverified.

| Check | Result |
|---|---|
| `npm test` | 73 test files passed; 735 tests passed, 14 skipped |
| Edge syntax/import/auth marker checks, included in `npm test` | Passed for 181 files |
| `npm run lint` | 0 errors, 1,453 warnings |
| `npx tsc --noEmit -p tsconfig.app.json` | Passed, exit 0 |
| `npm run build` | Passed; large-chunk warning; service worker precaches about 13.3 MiB |
| `node scripts/check-brand-strings.mjs` | Passed |
| `node scripts/reproduce-review-20260908.mjs` | Four diagnostic reproductions passed |

The diagnostic script asserts the current incorrect behavior to demonstrate the findings. It is not a passing regression suite for repaired behavior. It uses synthetic data, intercepts external services, and makes no network calls. During implementation, replace each diagnostic with a normal regression test that asserts the desired behavior.

## Findings

### R1. High priority: a share can refer to a note owned by another account

**Evidence:** [sharing policy, lines 21-27](https://github.com/MichaelZelbel/menerio/blob/811f75ecd5c067d203d624d9d48b7ac2a5f3b997/supabase/migrations/20260402085123_f9e751c1-fdae-43d1-968c-1ff29b794791.sql#L21), and the public lookup in the same file, lines 30-51.

The share policy checks that `shared_notes.user_id` is the caller. It never checks that the referenced note has that same owner. The foreign key checks only whether the note exists. The privileged public lookup joins that note and returns its content without comparing owners.

**Trigger and impact:** an authenticated caller who knows an unshared foreign note ID can create a share record under their own user ID. Under the committed schema, the public lookup can then return the other account's note. This requires knowledge of a note ID; this review did not establish an ID-discovery path. No later checked-in migration referencing `shared_notes` closes the gap.

This is a source-confirmed authorization defect, not a production exploit test. PostgreSQL documents that foreign-key checks bypass row security; a policy on `notes` does not repair this missing ownership check. [PostgreSQL row security documentation](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)

**Fix:** add an ownership invariant at the database boundary. Use a composite foreign key from `(note_id, user_id)` to a unique `(id, user_id)` on notes, and make the share policy explicitly require ownership of the referenced note. Add an owner equality predicate to the public lookup as defense in depth. Apply the lookup/policy restriction before validating historic rows, so invalid existing shares stop returning content immediately. Disable and privately record mismatched historic shares before validating the new constraint; do not silently change their owner. Retain legitimate shares and existing tokens.

**Acceptance:** database tests with two users reject foreign-note insert and retargeting, allow an owner share, preserve normal update/unshare, and return no content for a pre-existing mismatched share. Run as actual `authenticated` and anonymous roles, not only as the database owner.

### R2. High priority: account changes retain private cached data

**Evidence:** [authentication callback, lines 88-125](https://github.com/MichaelZelbel/menerio/blob/811f75ecd5c067d203d624d9d48b7ac2a5f3b997/src/contexts/AuthContext.tsx#L88), [group query key, line 76](https://github.com/MichaelZelbel/menerio/blob/811f75ecd5c067d203d624d9d48b7ac2a5f3b997/src/hooks/useGroups.ts#L76), and `src/App.tsx:80`.

The callback removes only conversation-topic queries from memory. Clearing persisted queries clears IndexedDB, not the shared in-memory QueryClient. The group-detail key omits the user ID and accepts a slug. Cached results remain fresh for five minutes.

**Trigger and impact:** account A opens the `friends` group, signs out, and account B opens that same slug without reloading the application. B can receive A's cached group without a server fetch. The local reproduction executes the current callback's removal statements and uses the installed QueryClient to reproduce this. It does not simulate the entire browser login flow.

**Fix:** centralize account transition handling. Cancel private requests, remove private in-memory data, isolate persistent storage by user, and gate rendering until transition cleanup completes. Add user IDs to every private query key and update their invalidation paths. Guard delayed profile/role results with a session generation so requests from the previous account cannot repopulate state. Token refresh for the same account should preserve valid cached data.

**Acceptance:** test A-to-signout-to-B, direct A-to-B, the same group slug, a bookmarked note ID, offline reload, two tabs, and a delayed A response arriving after B signs in. B must never render A's data. Add a shared query-key factory and an enforceable check for new private queries.

### R3. High priority: contact merging can delete data after a failed move

**Evidence:** [category moves and cleanup, lines 354-373](https://github.com/MichaelZelbel/menerio/blob/811f75ecd5c067d203d624d9d48b7ac2a5f3b997/supabase/functions/merge-contacts/index.ts#L354), with the analogous self-merge path at lines 265-282. `supabase/migrations/20260401224832_6e8a22bb-cfcc-4c52-9469-b39d0be20c13.sql:35` defines cascading deletion from categories to entries.

Several updates ignore the returned database error. The handler then deletes source categories and marks the source contact as merged. Separate REST calls cannot roll back the whole merge.

**Trigger and impact:** a category move returns a database error. The source category remains under the source contact, but cleanup can still delete it, taking profile entries with it. The local handler reproduction injects that move error and observes category deletion, a merged marker, and HTTP 200. The cascade itself was verified in migration code, not executed in a database.

**Fix:** move the merge into a single database transaction exposed through an authenticated database function. Derive or validate the caller, lock both contacts in stable ID order, validate ownership and lifecycle, move all dependent records, and mark the source only after success. Include topics and their existing lifecycle protections. Use a request ID and stored result to make retries safe. Move external vault updates to a durable job created by the transaction. Checking every error is immediate containment, but does not replace transactional integrity.

**Acceptance:** inject a failure at every write boundary and assert no partial changes. Test two concurrent merges, source/target reversal, repeated request IDs, duplicate categories, self-merge, and conversation-topic races. Snapshot counts and content for categories, entries, actions, interactions, notes, and topics before and after.

### R4. High priority for offline users: permanent errors can hold up every later edit

**Evidence:** [error classification, lines 78-84](https://github.com/MichaelZelbel/menerio/blob/811f75ecd5c067d203d624d9d48b7ac2a5f3b997/src/sync/connector.ts#L78), and retry behavior at lines 139-152.

The classifier expects digits after the class prefix. PostgreSQL error codes can contain letters, including `22P02` for invalid text representation. That error misses the permanent-error branch, throws, and leaves later operations unattempted. The actual bundled connector reproduces this with a synthetic `22P02` response. [PostgreSQL error code documentation](https://www.postgresql.org/docs/current/errcodes-appendix.html)

**Impact:** one invalid UUID or other invalid value can keep retrying and prevent subsequent offline edits from uploading. Applies to the PowerSync path, enabled on desktop and opted-in web sessions.

**Fix:** replace digit-only patterns with a documented classification table that understands alphanumeric codes. Distinguish invalid user data, expired authentication, deployment/schema errors, and temporary failures. Do not simply discard every class-42 error. Save rejected operations in a durable local recovery queue, with a visible error and retry/export options, before acknowledging them. Allow independent later operations through; preserve or explicitly quarantine dependent operations together.

**Acceptance:** exercise `22P02`, `23505`, `42501`, `42P01`, network errors, and expired tokens. Verify later independent edits upload, failed edits remain recoverable after restart, and transient failures still retry. Test a transaction that partially uploaded before losing its response.

### R5. Medium priority: scheduled GitHub sync reports success after rejection

**Evidence:** [scheduled caller, lines 68-88](https://github.com/MichaelZelbel/menerio/blob/811f75ecd5c067d203d624d9d48b7ac2a5f3b997/supabase/functions/github-sync-scheduled/index.ts#L68), and `supabase/functions/github-sync-pull/index.ts:175-193`.

The scheduler passes a GitHub token to a handler requiring a Supabase user token. It ignores the HTTP response, updates `last_sync_at`, and returns success. The reproduction supplies a downstream 401 and confirms both the success result and timestamp update. Whether this scheduled function currently runs in production is **UNVERIFIED**.

**Impact:** when invoked, failed synchronization appears successful and users can trust a mirror that was not refreshed.

**Fix:** extract the authenticated pull implementation into a shared server module. Manual requests authorize the user; scheduled jobs authorize the scheduler and select their user internally. Both call the same implementation with an explicit verified user/connection context. Never accept an unchecked user ID under service credentials. Record attempt and success timestamps separately, check all results, and use a lease per connection to prevent overlapping runs. Preserve GitHub tokens solely for GitHub requests.

**Acceptance:** reject unauthenticated and cross-user requests; handle GitHub 401, 403, 429, timeouts, partial imports, and successful no-change pulls. Only a completed pull may update the success timestamp. Test the actual scheduler entrypoint and shared pull module together.

### R6. Medium priority: unpaged queries silently omit contacts and merge references

**Evidence:** `src/hooks/usePeople.ts:62-69` selects contacts once without pagination. [Contact merge, lines 401-411](https://github.com/MichaelZelbel/menerio/blob/811f75ecd5c067d203d624d9d48b7ac2a5f3b997/supabase/functions/merge-contacts/index.ts#L401) does the same for all active notes.

Supabase normally limits a select response to 1,000 rows. The production setting was not checked; the defect occurs above the configured limit. These paths treat one response as the full result. [Supabase select documentation](https://supabase.com/docs/reference/javascript/select)

**Impact:** large contact lists appear incomplete, and merges can leave note references pointing at the old contact outside the first response page. This is source-confirmed against documented API behavior; a large database fixture was not run in this review.

**Fix:** use server-side pagination and search for the contacts UI, with a stable `(name, id)` order and a displayed total. Do not filter only the loaded page. For merge integrity, update matching references in the database transaction from R3 instead of downloading every note. For other bounded server jobs that require every row, reuse or improve `selectAllRows` with explicit ordering and a page size compatible with the configured server cap. Raising the cap only postpones the defect.

**Acceptance:** test 0, 1, exactly the configured cap, cap plus 1, and several pages; include duplicate names and an intentionally lower server cap. Put source references beyond the first page and verify all are repaired. Test pagination during concurrent edits.

## Implementation sequence

These are engineering estimates for one developer, not measured delivery times. Database environment setup and production data repair may add time.

| Order | Work package | Estimated effort | Completion gate |
|---|---|---|---|
| 1 | R1 sharing ownership and historic-share validation | 1-2 days | Real database role tests pass; valid shares remain usable |
| 2 | R2 account isolation and shared query-key policy | 2-3 days | Browser account-switch tests and delayed-response tests pass |
| 3 | R3 transactional merges, including R6 merge reference repair | 3-5 days | Failure injection leaves no partial merge; concurrency and existing topic tests pass |
| 4 | R4 upload error classification and durable recovery | 2-3 days | Offline failures remain recoverable; later independent edits upload |
| 5 | R5 shared GitHub pull and honest job status | 1-2 days | Scheduled and manual flows pass with success and failure responses |
| 6 | R6 contact pagination and search | 1-2 days | Results and totals remain correct beyond the server cap |

Recommended first implementation: R1 and R2, because leaving them unchanged risks exposing private data. Start with failing two-user tests, add the database ownership invariant and account-transition isolation, then run the acceptance checks above.

Each work package should be a separate reviewable pull request with its reproduction converted into a regression test. Keep schema changes additive. Deploy database protections before dependent frontend changes. Test migrations on a restored staging database, including old valid records and deliberately invalid fixtures. Keep security protections in place during application rollback.

R3 depends on the existing topic merge rules; its completion gate includes the existing topic SQL and concurrency suite. R6's merge repair belongs in R3, while contact-list pagination can follow separately. R4 and R5 have no dependency on the merge work.

## Preventing recurrence

Add a disposable PostgreSQL test job to CI that runs authenticated/anonymous authorization tests and transaction failure tests. The current suite primarily validates frontend behavior and pure server helpers. Text-based auth-marker checks cannot establish that a handler actually rejects a request.

Add `tsc --noEmit -p tsconfig.app.json` as an explicit CI step; the current build is not a substitute. Add a pinned Deno check for deployable functions once its imports and runtime are reproducible. Run the account-switch browser tests with two synthetic users. Require these focused checks for the corresponding work packages rather than expanding unrelated test suites.

The 1,453 lint warnings and permissive TypeScript settings reduce the usefulness of static checks, but they are not themselves 1,453 bugs. Set a warning baseline and stop increases, then tighten types around auth, database responses, and synchronization as those modules change. Avoid a repository-wide type rewrite before the data-protection repairs.

Measure cold-load and offline-install behavior before changing the roughly 13.3 MiB precache. The large-chunk warning is a performance investigation item, not a confirmed user-facing failure from this review.

After deployment, monitor rejected cross-owner shares, failed merge transactions, recoverable upload errors, and sync attempt-versus-success counts. Record IDs and error categories without note content or credentials. Verify each behavior in staging first, then use read-only production checks to confirm the deployed schema and functions match the reviewed fixes.
