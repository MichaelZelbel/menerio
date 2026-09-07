# Conversation topics: tested result

Verified on 7 September 2026, using synthetic data only. Production migration, function deployment, and frontend publication have not been performed.

## Delivered

Native person topics support High/Normal/Low priority, one-off and recurring discussions, historical wording, archive, reopen, and append-only undo. The person panel sits below the identity and above the tabs, with five-topic preview, separate state views, keyboard capture, history, retry-safe commands, and preserved drafts during external edits.

Browser and all eight MCP topic tools share database commands. Owner policies, service-only entrypoints, AI visibility, request receipts, version checks, and lifecycle locks protect writes. Active topics appear in both person-context responses. Realtime subscriptions plus focus/reconnect and a visible-page polling fallback refresh an open profile. Topics are excluded from persisted browser caches.

Merging people transfers topic IDs and history atomically with the merge marker. A self-merge with topics requires reassignment; an interrupted self-merge remains visible and resumable. Deletion explicitly cascades the deleted person's topics and history. The existing multi-request profile merge is not converted into a whole-profile transaction.

The shared hub `talk-about` skill handles capture, discussion completion, prioritization, call preparation, ambiguity, retries, German requests, and dated discussion versus explicit reminders. It creates no substitute notes or reminders.

## Verification

- Full repository suite: 732 passed, 14 skipped, all 73 test files passed, including the final overlapping-merge interruption regression.
- Feature UI and hook suite: 19 tests, including pagination beyond 1,000 high-priority topics, stale drafts, retained rows, account changes, retry receipts, and refresh cleanup.
- MCP transport unit suite: 13 tests. Actual full MCP entrypoint additionally passed HTTP integration tests through the SDK client, including advertised schemas, malformed inputs, scopes, owner isolation, retries, aliases, history, and both person-context responses.
- PostgreSQL 16 with pgTAP: all 51 assertions passed. Separate concurrent-session checks passed for repeated requests, stale versions, rollback after injected event failure, both capture/merge orderings, lock interleaving, failed merge rollback, and private merge-target retries.
- Production frontend build and TypeScript checks passed. Full lint had zero errors and 1,454 warnings, compared with 1,434 baseline warnings; warnings are not reported as a clean lint result.
- All 34 synthetic natural-language skill examples passed independent model-based scenario review. These are scenario evaluations, not live memory writes or deterministic tool execution. Skill structure validation passed.

## Actual UI verification

Headless Chromium exercised the actual PersonDetail page and production topic components with synthetic authentication, the actual MCP handler, and a local PostgreSQL-backed HTTP adapter. It verified Enter capture in the browser then MCP retrieval, browser discussion then MCP history, MCP capture appearing in the already-open page through the 30-second fallback, recurring discussion remaining active, original wording after editing, MCP completion, browser reopen/archive/undo, priority preview, and the Conversation tab remaining reachable. No browser page errors or horizontal page overflow occurred.

Mobile at 390px and desktop at 1280px were captured in light and dark themes and visually inspected. Identity actions wrap on mobile; topics remain above the tabs.

| Mobile light | Mobile dark |
| --- | --- |
| ![Mobile light](assets/contact-topics/mobile-light.png) | ![Mobile dark](assets/contact-topics/mobile-dark.png) |

[Desktop light](assets/contact-topics/desktop-light.png) · [Desktop dark](assets/contact-topics/desktop-dark.png)

The local adapter is not hosted Supabase PostgREST, authentication, or Realtime. Actual hosted login, Realtime delivery, mobile touch hardware, and screen-reader behavior remain release smoke checks. Subscription behavior has automated hook coverage; real fallback refresh has browser coverage. No live personal fixtures were created.

## Release status

The hub skill is pushed to hub origin. Menerio is prepared on `codex/person-conversation-topics`. Approve the [exact production rollout](CONTACT_TOPICS.md#release-preparation) before applying the migration or publishing. Until then, production users do not receive the feature.
