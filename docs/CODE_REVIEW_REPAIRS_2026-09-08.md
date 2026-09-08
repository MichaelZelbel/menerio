# Repairs for the 8 September code review

Implemented all six findings on `codex/code-review-20260908`, starting from `a95d69d3`. After Michael requested production deployment, merged the reviewed revision `ce4ae389be687e6867ec541d08727468094a8431` into `main` and deployed it on 8 September 2026.

## Production deployment

- All five migrations applied and recorded in one production transaction. Both ownership constraints are validated. Preflight found zero mismatched shares or GitHub note links, and both private quarantine tables remain empty.
- Deployed `merge-contacts`, `github-sync-pull`, `github-sync-scheduled` and `github-people-sync`; all report active.
- Published the matching Lovable revision. [Menerio](https://menerio.com/) serves deployment `f5650553-6ea0-483e-af83-f76246c4bd32` with the new account-cache/recovery code and contact-search page bundle.
- Live read-only authenticated-role contact search returned three rows with a total matching the database. Authenticated users can invoke the merge function; anonymous users cannot. All three merge/pull/scheduler HTTP entrypoints rejected unauthenticated requests with 401.
- The live browser rendered the sign-in page correctly for a protected contact URL. No real-account merge, vault synchronization or browser account-switch operation was performed in production; the synthetic database/browser acceptance results below cover those scenarios.
- Existing application records were not changed by smoke checks. The original public-share function definition was retained locally before migration for incident investigation; security constraints must remain in place during any application rollback.

## Changes

| Finding | Repair |
|---|---|
| R1 | Composite note/owner constraint, explicit share ownership policy, owner-checked public lookup. Invalid historic shares move into a private audit table; valid tokens remain intact. |
| R2 | A new query client per account, automatic owner suffix on query keys, account-specific IndexedDB persistence, rendering gate, generation checks for delayed profile/role responses. Same-account token refresh preserves cache. |
| R3 | One authenticated PostgreSQL transaction with ordered locks, durable request receipts and vault jobs. Moves categories, entries, actions, interactions, memberships, relationships, topics and all note references. Original duplicate or trigger-suppressed data is preserved in receipts. |
| R4 | Alphanumeric SQLSTATE classification, durable recovery groups, dependency preservation, confirmed-write checkpoints, visible retry/export. Account cleanup preserves interrupted journals. Requests use the validated account's captured token. Unsafe concurrent uploading without Web Locks fails before writes or acknowledgement. |
| R5 | Manual and scheduled entrypoints call the same pull implementation after authorization. Service-only leases separate attempt and success times. HTTP/database/partial errors cannot record success. Vault jobs require proof of source retirement and current target synchronization. Sync-log note references also receive an owner constraint. |
| R6 | Server search, name/ID cursor pagination and totals, independent detail loading and global merge/recipient pickers. Merge reference repair runs in SQL. Vault reads page through all results even when the server returns fewer rows than requested. |

The original diagnostic command now runs repaired-behavior regression tests instead of asserting the old defects.

## Local verification

- Full suite: 81 files, 810 passed, 14 skipped.
- Application TypeScript check passed.
- ESLint: zero errors, 1,450 warnings, below the original 1,453 baseline. CI now refuses an increase above that baseline.
- Build, edge syntax/import/auth checks and brand-string check passed. The existing large bundle warning remains; service-worker precache is about 13.3 MiB.
- PostgreSQL sharing tests ran as authenticated and anonymous roles, including foreign insertion/retargeting, valid token lifecycle, private historic audit and privileged constraint enforcement.
- PostgreSQL merge tests injected 16 person-merge and 8 self-merge write failures, comparing full row-content snapshots after rollback. Concurrent duplicate requests, reversal, both topic race orders, 2,501 note references, and actual profile/relationship normalization and rejection functions were exercised. The existing 51 topic SQL assertions also passed.
- PostgreSQL contact tests covered 0, 1, 3, 4, 13, 1,001 and 2,501 contacts, duplicate names, aliases beyond the first page, small page limits, caller isolation, concurrent insert/delete and rename/refresh behavior.
- PostgreSQL GitHub tests covered lease ownership/grants, overlap, stale completion, renewal, attempt/success separation, and sync-log ownership quarantine.
- Actual scheduler/manual entrypoints and shared pull ran against synthetic service responses: GitHub 401/403/429/504, timeout, partial import, no changes, bad authorization, supplied foreign user and foreign note reference.
- Real Chromium ran the actual AuthProvider and query persister with synthetic authentication: two-tab account changes, same group slug/bookmarked note, delayed profile, reload with query fetching disabled, real IndexedDB recovery reload and concurrent tab writes.

The browser fixture does not use real Supabase accounts or exercise the complete PowerSync SQLite runtime. Its offline check disables query fetching while the local fixture itself remains reachable. PostgreSQL fixtures use relevant real functions and constraints, but do not constitute a restored staging database or a replay of every historic migration. A restored-staging replay remains unperformed. Production checks are listed above. The 14 existing skipped tests remain skipped.

## CI and commands

CI runs a clean Node 20 installation, frontend checks, disposable PostgreSQL authorization/transaction tests, and a separate Chromium/IndexedDB job. Browser tooling is pinned outside application dependencies.

```sh
npm test
npx tsc --noEmit -p tsconfig.app.json
npm run lint -- --max-warnings 1453
npm run build
node scripts/check-brand-strings.mjs
node scripts/reproduce-review-20260908.mjs
```

Database fixtures refuse non-test database names. Exact fresh-database commands are in `.github/workflows/ci.yml`. Browser acceptance uses `node scripts/test-review-browser.mjs`; set `REVIEW_PLAYWRIGHT_MODULE` to an installed Playwright module path and optionally `REVIEW_CHROME` to an installed Chrome executable.

## Deployment order

1. Test the five additive `20260908120001` through `20260908120005` migrations on a restored staging database. They depend on the existing contact-topic and normalization schema. Validate historic valid records and deliberately invalid owner fixtures.
2. Apply database protections and transactional functions before the dependent application code. Keep protections if application code is rolled back. Private audit records and merge receipts must stay inaccessible to other accounts.
3. Deploy `merge-contacts`, `github-sync-pull` and `github-sync-scheduled`, then the frontend. Shared helper changes also affect `github-people-sync` and other importing GitHub handlers when they are next deployed.
4. Run staging account-switch/offline and scheduler checks with synthetic users, then obtain approval for production deployment. Michael provided that approval in this task; deployment and the limited live smoke checks are recorded above. Past exposure was not investigated.

Merge vault jobs stay pending while export is disabled or a target is conflicted, missing or stale. The scheduled sync completes them only after the required export/retirement is confirmed. Monitor pending age and failed attempts using identifiers and error categories, without note content or credentials.
