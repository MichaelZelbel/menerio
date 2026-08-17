# Menerio Audit Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close eleven defects found in a read-only audit of `main` at commit `e5a8c6e9`, fixing each at its root so the fix cannot rot back out at a call site.

**Architecture:** Nine of the eleven share one shape: a correct helper already exists and most call sites do not use it, or a failure is caught and then reported as a success. So the work is mostly (a) put the invariant inside the one function everybody already calls, and (b) delete the call site's freedom to skip it. Two are genuine logic bugs in the offline sync upload path and are fixed in place. No new subsystems, no schema redesign.

**Tech Stack:** React 18 + TypeScript + Vite, TanStack Query, PowerSync (offline SQLite replica), Supabase (Postgres + PostgREST + Deno edge functions), Vitest.

**Spec:** This plan is its own spec — the findings section below states what is wrong and why, with the file and line each claim came from.

---

## Global Constraints

- **Test runner is Vitest, run with `npx vitest run`.** It collects `src/**/*.{test,spec}.{ts,tsx}` and `supabase/functions/**/__tests__/*.{test,spec}.ts` (`vitest.config.ts:12-18`). An edge-function helper is only testable if it is **pure TypeScript with no `Deno.*` API** — Vitest runs it in Node. Put such tests in `supabase/functions/_shared/__tests__/`.
- **CI runs `npm run lint`, `node scripts/check-brand-strings.mjs`, `npm test`, `npm run build`** on every push to `main` and every PR (`.github/workflows/ci.yml`). All four must pass.
- **This repo is Lovable-synced and goes stale fast.** Run `git pull --rebase origin main` before starting each task.
- **Deploying an edge function requires the Lovable workspace, which bills credits per agent turn.** Batch the edge-function tasks into as few deploys as possible. Deploy strictly before migrating.
- **Do not route SQL through the Lovable agent.** Use `chrome-bridge` against the Supabase dashboard SQL editor (`https://supabase.com/dashboard/project/tjeapelvjlmbxafsmjef/sql`) — it is free and already authenticated.
- **`llm_call_configs` is cached 30s in the edge runtime** (`CACHE_TTL_MS`, `_shared/llm-router.ts:54`). Wait longer than that after a row change before testing.
- **Never use `sync_defaults` with `force: true`** — it overwrites hand-picked models on at least four rows.
- **Rollback SQL goes in `supabase/rollback/`, never in `supabase/migrations/`.**

---

## Findings

Ranked by what it costs when it fires. "Verified" means I read the code path end to end; nothing here is inferred from a name.

| # | Severity | What breaks | Where |
|---|---|---|---|
| 1 | **Data loss** | One permanently-failing op silently discards every later op in the same sync transaction | `src/sync/connector.ts:99-108` |
| 2 | **Data loss** | A malformed local JSON value wedges the upload queue forever — all later edits stop syncing | `src/sync/connector.ts:36-38` |
| 3 | **Data loss** | A note's existing chunks are deleted, then a mid-run failure leaves it with a fraction of them | `_shared/chunk-embeddings.ts:61-64` |
| 4 | **Security** | Server-side request forgery reachable from an LLM tool call | `_shared/collection-schema.ts:116-122` |
| 5 | **Billing** | The credit gate is advisory on the main LLM path — a zero balance does not stop a call | `_shared/llm-router.ts:481-505` |
| 6 | Correctness | Reported chunk count overstates reality whenever embedding stops early | `_shared/chunk-embeddings.ts:98` |
| 7 | Silent gap | Notes processed by the sweep or after OCR never get connections computed, with no log line | `process-note/index.ts:2684-2691` |
| 8 | Correctness | The replica health check silently caps at 1000 notes, so it misreports once the corpus is bigger | `src/sync/local-replica.ts:113-127` |
| 9 | Correctness | "Recompute for all users" really means "users appearing in the first 1000 note rows" | `recompute-all-connections/index.ts:60-65` |
| 10 | Correctness | Search breaks on any query containing `,` `(` `)` — at ~10 call sites | see Task 5 |
| 11 | Process | CI has been red on `main` since 2026-08-15, so the gate protects nothing | `src/hooks/__tests__/useContactProfile.test.tsx` |

### The detail behind each

**1 — one bad op discards the rest of the transaction.** `uploadData` loops over `transaction.crud`. When an op throws a permanent Postgres error (22xxx/23xxx/42xxx), the `catch` calls `transaction.complete()`, which marks the *whole* transaction uploaded. Ops after the failing one were never attempted and are now gone. Only the one failing op is logged, so the user sees nothing.

**2 — a parse error wedges the queue.** `toPostgresRecord` calls `JSON.parse(value)` unguarded (`connector.ts:38`). A `SyntaxError` has no `.code`, so `isFatalError` returns false, so it is rethrown as retryable, so PowerSync retries the same transaction forever. Every later local edit queues behind it and never syncs. This is precisely the permanent wedge the `FATAL_CODES` list was written to prevent, but a non-Postgres error cannot be classified by it.

**3 and 6 — partial chunk replacement, then an inflated count.** The delete of old chunks is deferred until the first embedding succeeds (`chunk-embeddings.ts:61-64`), with a comment explaining that deleting up front turned a transient failure into data loss. But the guard only covers *total* failure. If chunk 0 succeeds and chunk 1 runs out of credits, the old chunks are already deleted and the note keeps exactly one. Then `chunkCount: limited.length - failures` (line 98) is computed from the full chunk list even though the loop `break`s early — 50 chunks, break after 2 with 1 failure, reports 49. `backfill-embeddings/index.ts:100` adds that to a total, `process-note/index.ts:2429` reports it, and `menerio-mcp/index.ts:982` tests `chunkCount === 0` to detect failure, so a mostly-failed run reads as a success.

**4 — SSRF.** `fetchUrlAsText` fetches an arbitrary URL with `redirect: "follow"`, no scheme check, no host check, no timeout, and reads the entire body before truncating. Its only caller is the `extract_item_from_url` tool in `collection-chat/index.ts:275`, which passes `String(args.url || "")` straight through — and `args` is whatever the **model** emitted, so note content can steer it. A correct guard already exists in `_shared/ssrf-guard.ts` (blocks link-local, private ranges, CGNAT, re-validates each redirect hop) and is imported by exactly one function.

**5 — the credit gate does not gate.** `openRouterWithCredits` pre-checks the balance and throws before spending (`llm-credits.ts:163-171`). `runChat` — the central router every migrated call site uses — does neither: no pre-check, and the post-call `deductTokens` sits in a `try/catch` that only `console.warn`s (`llm-router.ts:481-505`). So a user at zero balance keeps getting answers; the deduction throws `INSUFFICIENT_CREDITS`, is swallowed, and the content is returned. Separately, 8 of the 18 `runChat` call sites do no balance check of their own at all: `admin-llm-config`, `ai-moderate-content`, `classify-profile-fact`, `daily-digest`, `generate-profile-suggestions`, `profile-audit`, `wiki-ingest`, `wiki-restructure`.

**7 — connections silently never computed.** `process-note` accepts an internal caller that presents the service-role key (`index.ts:2732`), then passes that same `authHeader` down to the fire-and-forget `compute-connections` call (`index.ts:2684-2691`). But `compute-connections` only accepts a **user JWT** — it calls `supabase.auth.getUser(token)` and 401s on failure (`compute-connections/index.ts:31-35`), with no service-role bypass. A service-role key is not a user JWT, so it 401s. `fetch` resolves normally on a 401, so the attached `.catch()` never fires and **nothing is logged**. Every note processed via `sweep-note-processing` (which calls with `Bearer ${SERVICE_ROLE_KEY}`, `index.ts:91`) or re-processed after OCR by `analyze-media/index.ts:437` gets no connections. The sweep is the safety net for exactly the case where the user navigated away, so this hits the notes most likely to need it.

**8 — the health check under-reports.** `getReplicaDiagnostics` selects server notes with no `.range()` and no `.limit()` (`local-replica.ts:113-117`), so PostgREST caps it at 1000 rows. `serverTotal` pins at 1000 and `missingIds` is computed against a partial set — the diagnostic that exists to detect a broken replica becomes the thing that hides one. `repairLocalReplica`, twenty lines below, pages correctly with `.range()`, so the fix pattern is already in the file.

**9 — "all users" is not all users.** `recompute-all-connections` selects `user_id` from `notes` with `.limit(1000)` and dedupes (`index.ts:60-65`). That is the first 1000 note *rows*, not 1000 users. One prolific user's notes crowd out everyone else. Single-tenant today, so the blast radius is small now and grows silently.

**10 — search breaks on punctuation.** A PostgREST `.or()` string uses `,` to separate conditions and `()` to group them. Interpolating a raw search term means a query containing a comma is parsed as extra conditions and the request 400s. `src/lib/postgrest.ts` already solves this correctly and has tests (`src/lib/__tests__/postgrest.test.ts`) — `escapeLike`, `pgOrValue`, and `ilikeContains`, which is exactly the fragment these sites need. It is used in **three** places. Meanwhile `menerio-mcp/index.ts:1749` invented a third strategy that strips `,()'"\*%_` to spaces, which is lossy (searching for `Q1 (draft)` silently searches for `Q1 draft`). The edge functions cannot import from `src/lib`, so there is no shared helper on the Deno side at all.

Affected sites taking user text: `hub-api-contacts:141`, `hub-api-notes:79`, `search-notes-semantic:35`, `menerio-mcp:664`, `:749`, `:1439`, `:2681`, `_shared/read-tools.ts:213`, `:233`, `src/pages/CollectionDetail.tsx:911`. The `.or()` calls that interpolate UUIDs or timestamps (`get-graph-data:356`, `profile-reconcile:138`, `read-tools:111`, `hub-api-world:120`, `:137`, `profile-lint:72`, `useGraphData:95`, `useReviewQueue:59`, `:77`, `WikiPage:121`, `profile-fields-registry:39`) are **not** in scope — those values cannot contain the delimiters.

**11 — CI is red.** Commit `0c16b62f` ("Handled async normalize-profile", 2026-08-15) changed `useContactProfile.ts:179` to call `supabase.functions.invoke("normalize-profile", ...)`. The test's Supabase mock (`__tests__/useContactProfile.test.tsx:16-30`) only stubs `.from`, so `supabase.functions` is `undefined` and the test throws. `npm test` has failed on `main` for two days. The regression it guards — a quick-add into a not-yet-materialized category leaving the stale categories cache hiding the new section — is currently unguarded.

### Not bugs (checked and cleared)

Recording these so nobody re-opens them: the `@supabase/supabase-js@2/cors` import is a real export path; `mistral` is missing from the original provider CHECK constraint but was added by `20260601175800_*.sql`; `singlefile-capture` carries its own copy of the SSRF guard rather than lacking one; share-link moderation looks client-side but has a server-side backstop that revokes the link (`ai-moderate-content/index.ts:97-99`); RLS is enabled on 80 of 80 real tables; `escapeLike` in `useNotes.ts:97` looks like a duplicate but escapes for **SQLite** `LIKE ... ESCAPE '\'`, a genuinely different context from the PostgREST helper.

---

## File Structure

**Created:**
- `supabase/functions/_shared/postgrest-filters.ts` — the Deno-side twin of `src/lib/postgrest.ts`. Pure TS, no Deno APIs, so Vitest can test it.
- `supabase/functions/_shared/__tests__/postgrest-filters.test.ts`
- `supabase/functions/_shared/__tests__/ssrf-guard.test.ts` — `ssrf-guard.ts` is already pure and already correct; it has no tests, and Task 4 makes it load-bearing for a second caller.
- `supabase/functions/_shared/paged-select.ts` — one `selectAllRows` helper, so "fetch every row" stops meaning "the first 1000".
- `supabase/functions/_shared/__tests__/paged-select.test.ts`
- `src/sync/__tests__/connector.test.ts`
- `supabase/functions/_shared/__tests__/chunk-embeddings.test.ts`
- `supabase/rollback/2026-08-17-audit-fixes-rollback.sql`

**Modified:** `src/sync/connector.ts`, `src/sync/local-replica.ts`, `src/hooks/__tests__/useContactProfile.test.tsx`, `src/pages/CollectionDetail.tsx`, `supabase/functions/_shared/{collection-schema,llm-router,chunk-embeddings,read-tools}.ts`, `supabase/functions/{compute-connections,process-note,recompute-all-connections,hub-api-contacts,hub-api-notes,search-notes-semantic,menerio-mcp}/index.ts`.

---

## Task Order And Why

Task 1 restores the red baseline — until `npm test` is green, no later task can tell its own failure apart from the existing one. Tasks 2-3 are pure frontend and ship with no deploy. Tasks 4-8 are edge functions; they are ordered so the riskiest (5, the billing path) lands with the verification from 4 already in place, and they should be batched into one or two Lovable deploys. Tasks 9-10 are the low-risk correctness cleanups.

---

### Task 1: Restore the green test baseline

**Files:**
- Modify: `src/hooks/__tests__/useContactProfile.test.tsx:16-30`

**Interfaces:**
- Consumes: nothing.
- Produces: a green `npx vitest run`, which every later task's verification depends on.

- [ ] **Step 1: Confirm the failure and its cause**

Run: `npx vitest run src/hooks/__tests__/useContactProfile.test.tsx`

Expected: FAIL with `TypeError: Cannot read properties of undefined (reading 'invoke')` at `src/hooks/useContactProfile.ts:179`.

The production code is correct; the mock is stale. `upsertEntry` routes a **new** entry through the `normalize-profile` edge function so the server-side profile guards can refuse the write, and reads `data.reason` back.

- [ ] **Step 2: Add the missing `functions.invoke` stub to the mock**

In `src/hooks/__tests__/useContactProfile.test.tsx`, replace the `vi.mock("@/integrations/supabase/client", ...)` block with:

```tsx
// Minimal chainable supabase mock: list queries resolve empty, mutations
// succeed. Only the shapes useContactProfile actually calls are implemented.
// `functions.invoke` is here because a NEW profile entry is written through the
// normalize-profile edge function (useContactProfile.ts), not by a direct
// insert — the server-side guards can refuse the write and return a `reason`.
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            order: async () => ({ data: [], error: null }),
          }),
        }),
      }),
      insert: async () => ({ error: null }),
      update: () => ({ eq: async () => ({ error: null }) }),
      delete: () => ({ eq: async () => ({ error: null }) }),
    }),
    functions: {
      invoke: async () => ({ data: { reason: null }, error: null }),
    },
  },
}));
```

- [ ] **Step 3: Run the test to verify it passes**

Run: `npx vitest run src/hooks/__tests__/useContactProfile.test.tsx`
Expected: PASS, 1 test.

- [ ] **Step 4: Run the whole suite to confirm the baseline is green**

Run: `npx vitest run`
Expected: 39 files passed, 378 tests passed, 0 failed.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/__tests__/useContactProfile.test.tsx
git commit -m "fix(test): stub supabase.functions.invoke so the profile cache test runs again

The hook moved new-entry writes to the normalize-profile edge function in
0c16b62f; the mock still only stubbed .from, so npm test has failed on main
since 2026-08-15 and the cache-invalidation regression was unguarded."
```

---

### Task 2: Stop one bad sync op from discarding the rest of the transaction

**Files:**
- Modify: `src/sync/connector.ts:71-109`
- Create: `src/sync/__tests__/connector.test.ts`

**Interfaces:**
- Consumes: green baseline from Task 1.
- Produces: `SupabaseConnector.uploadData(database)` unchanged in signature. New non-exported `applyOp(op: CrudEntry): Promise<void>`.

Replaying a whole transaction is safe: PUT is an upsert, PATCH is an update by id, DELETE is a delete by id. All three are idempotent, so a retry that re-applies already-succeeded ops cannot corrupt anything.

- [ ] **Step 1: Write the failing test**

Create `src/sync/__tests__/connector.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";
import { UpdateType } from "@powersync/web";

const upsert = vi.fn();
const update = vi.fn();
const del = vi.fn();

vi.mock("@powersync/web", () => ({
  UpdateType: { PUT: "PUT", PATCH: "PATCH", DELETE: "DELETE" },
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      upsert: (...a: unknown[]) => upsert(...a),
      update: (...a: unknown[]) => ({ eq: () => update(...a) }),
      delete: () => ({ eq: (...a: unknown[]) => del(...a) }),
    }),
  },
}));

vi.mock("../config", () => ({ POWERSYNC_URL: "https://example.invalid" }));

import { SupabaseConnector } from "../connector";

function put(id: string, opData: Record<string, unknown> = {}) {
  return { op: UpdateType.PUT, table: "notes", id, opData };
}

function fakeDb(crud: unknown[], complete: () => void) {
  return {
    getNextCrudTransaction: async () => ({ crud, complete: async () => complete() }),
  };
}

beforeEach(() => {
  upsert.mockReset().mockResolvedValue({ error: null });
  update.mockReset().mockResolvedValue({ error: null });
  del.mockReset().mockResolvedValue({ error: null });
});

describe("SupabaseConnector.uploadData", () => {
  it("still attempts later ops after one op fails permanently", async () => {
    // op 2 hits a unique violation (23505) — permanent, never succeeds on retry.
    upsert
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({ error: { code: "23505", message: "duplicate key" } })
      .mockResolvedValueOnce({ error: null });

    const complete = vi.fn();
    const db = fakeDb([put("a"), put("b"), put("c")], complete);

    await new SupabaseConnector().uploadData(db as never);

    // The bug: op "c" was never attempted, because the catch completed the
    // whole transaction the moment "b" failed.
    expect(upsert).toHaveBeenCalledTimes(3);
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it("rethrows a retryable failure so PowerSync retries the transaction", async () => {
    upsert.mockResolvedValueOnce({ error: { code: "08006", message: "connection failure" } });
    const complete = vi.fn();
    const db = fakeDb([put("a")], complete);

    await expect(new SupabaseConnector().uploadData(db as never)).rejects.toBeTruthy();
    expect(complete).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run src/sync/__tests__/connector.test.ts`
Expected: FAIL — first test reports `upsert` called 2 times, not 3.

- [ ] **Step 3: Implement per-op isolation**

In `src/sync/connector.ts`, replace the whole `uploadData` method (lines 71-109) with:

```ts
  private async applyOp(op: CrudEntry): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const table = supabase.from(op.table as any);
    if (op.op === UpdateType.PUT) {
      const record = { ...toPostgresRecord(op.table, op.opData ?? {}), id: op.id };
      const { error } = await table.upsert(record);
      if (error) throw error;
    } else if (op.op === UpdateType.PATCH) {
      if (op.opData && Object.keys(op.opData).length > 0) {
        const record = toPostgresRecord(op.table, op.opData);
        if (Object.keys(record).length > 0) {
          const { error } = await table.update(record).eq("id", op.id);
          if (error) throw error;
        }
      }
    } else if (op.op === UpdateType.DELETE) {
      const { error } = await table.delete().eq("id", op.id);
      if (error) throw error;
    }
  }

  async uploadData(database: AbstractPowerSyncDatabase): Promise<void> {
    const transaction = await database.getNextCrudTransaction();
    if (!transaction) return;

    // A permanently-failing op is skipped, NOT allowed to take the rest of the
    // transaction with it. The previous version completed the whole transaction
    // from inside the catch, so every op after the failing one was discarded
    // without ever being attempted — silent loss of the user's later edits.
    //
    // A retryable failure still throws, so PowerSync replays the transaction
    // with backoff. Replay is safe: PUT is an upsert, PATCH and DELETE are keyed
    // by id, so re-applying an op that already succeeded is a no-op.
    const discarded: Array<{ op: CrudEntry; error: unknown }> = [];
    for (const op of transaction.crud) {
      try {
        await this.applyOp(op);
      } catch (error) {
        if (!isFatalError(error)) throw error;
        discarded.push({ op, error });
      }
    }

    for (const { op, error } of discarded) {
      console.error("Discarding unrecoverable sync operation", op, error);
    }
    await transaction.complete();
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/sync/__tests__/connector.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add src/sync/connector.ts src/sync/__tests__/connector.test.ts
git commit -m "fix(sync): skip only the failing op, not the rest of the transaction

A permanent Postgres error completed the whole CRUD transaction from inside
the catch, so every op queued after the failing one was dropped without being
attempted. Those were the user's edits and nothing logged them."
```

---

### Task 3: Stop a malformed JSON column from wedging the upload queue

**Files:**
- Modify: `src/sync/connector.ts:26-57`
- Modify: `src/sync/__tests__/connector.test.ts`

**Interfaces:**
- Consumes: `applyOp` / `uploadData` from Task 2, and `isFatalError(error: unknown): boolean`.
- Produces: exported `class FatalSyncError extends Error`.

- [ ] **Step 1: Write the failing test**

Append to `src/sync/__tests__/connector.test.ts`:

```ts
describe("malformed JSON in a synced column", () => {
  it("is treated as permanent, so the queue drains instead of wedging", async () => {
    const complete = vi.fn();
    // `metadata` is a JSON column; a truncated value can never be parsed, so
    // retrying it forever would block every later edit behind it.
    const db = fakeDb([put("a", { metadata: "{not json" }), put("b", { metadata: "{}" })], complete);

    await new SupabaseConnector().uploadData(db as never);

    expect(complete).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledTimes(1); // "a" never reached the network, "b" did
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run src/sync/__tests__/connector.test.ts`
Expected: FAIL — the `SyntaxError` from `JSON.parse` is classified as retryable and rethrown, so `uploadData` rejects and `complete` is never called.

- [ ] **Step 3: Implement the guard**

In `src/sync/connector.ts`, add above `toPostgresRecord`:

```ts
/**
 * A local value that can never be accepted upstream, however many times we try.
 *
 * `isFatalError` classifies by Postgres SQLSTATE, which a client-side parse
 * failure does not have — so an unparseable JSON column was rethrown as
 * retryable and PowerSync replayed the same transaction forever, with every
 * later edit stuck behind it. That is the exact permanent wedge FATAL_CODES
 * exists to prevent; it just could not see this class of error.
 */
export class FatalSyncError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "FatalSyncError";
  }
}

function parseJsonColumn(table: string, key: string, value: string): unknown {
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new FatalSyncError(`malformed JSON in ${table}.${key}`, error);
  }
}
```

Change the JSON branch of `toPostgresRecord` (line 36-38) to:

```ts
    if (jsonCols.includes(key)) {
      record[key] =
        typeof value === "string" && value !== ""
          ? parseJsonColumn(table, key, value)
          : value;
    } else if (boolCols.includes(key)) {
```

And teach `isFatalError` about it (line 53-57):

```ts
function isFatalError(error: unknown): boolean {
  if (error instanceof FatalSyncError) return true;
  const code = (error as { code?: string } | null)?.code;
  if (typeof code !== "string") return false;
  return FATAL_CODES.some((re) => re.test(code));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/sync/__tests__/connector.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Run the whole suite and commit**

Run: `npx vitest run` → expect all green.

```bash
git add src/sync/connector.ts src/sync/__tests__/connector.test.ts
git commit -m "fix(sync): classify a malformed JSON column as permanent

JSON.parse threw a SyntaxError, which carries no SQLSTATE, so it was retried
forever and every later local edit queued behind it stopped syncing."
```

---

### Task 4: Put the SSRF guard in front of `fetchUrlAsText`

**Files:**
- Modify: `supabase/functions/_shared/collection-schema.ts:115-130`
- Modify: `supabase/functions/_shared/ssrf-guard.ts` (add `safeFetchText`)
- Create: `supabase/functions/_shared/__tests__/ssrf-guard.test.ts`

**Interfaces:**
- Consumes: existing `isSafeOutboundUrl(raw: string, opts?: { requireHttps?: boolean }): boolean` and `isBlockedHost(host: string): boolean` from `_shared/ssrf-guard.ts`.
- Produces: `safeFetchText(startUrl: string, opts?: { timeoutMs?: number; maxBytes?: number }): Promise<string>`, which throws on a refused or oversized URL. `fetchUrlAsText` keeps its signature `(url: string, maxChars?: number) => Promise<string>`.

`ssrf-guard.ts` is pure TypeScript today and must stay that way so Vitest can run it.

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/_shared/__tests__/ssrf-guard.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isBlockedHost, isSafeOutboundUrl } from "../ssrf-guard.ts";

describe("isBlockedHost", () => {
  it("blocks the cloud metadata address", () => {
    expect(isBlockedHost("169.254.169.254")).toBe(true);
    expect(isBlockedHost("metadata.google.internal")).toBe(true);
  });

  it("blocks loopback, private ranges and CGNAT", () => {
    for (const h of ["localhost", "127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "100.64.0.1", "::1"]) {
      expect(isBlockedHost(h), h).toBe(true);
    }
  });

  it("allows an ordinary public host", () => {
    expect(isBlockedHost("example.com")).toBe(false);
    expect(isBlockedHost("93.184.216.34")).toBe(false);
  });
});

describe("isSafeOutboundUrl", () => {
  it("refuses non-https schemes", () => {
    expect(isSafeOutboundUrl("http://example.com")).toBe(false);
    expect(isSafeOutboundUrl("file:///etc/passwd")).toBe(false);
    expect(isSafeOutboundUrl("data:text/html,hi")).toBe(false);
  });

  it("refuses embedded credentials", () => {
    expect(isSafeOutboundUrl("https://user:pw@example.com")).toBe(false);
  });

  it("refuses internal hosts and accepts public ones", () => {
    expect(isSafeOutboundUrl("https://169.254.169.254/latest/meta-data/")).toBe(false);
    expect(isSafeOutboundUrl("https://example.com/page")).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify the guard itself is sound**

Run: `npx vitest run supabase/functions/_shared/__tests__/ssrf-guard.test.ts`
Expected: PASS. The guard is already correct — this test pins it, because Task 4 makes a second caller depend on it.

- [ ] **Step 3: Add `safeFetchText` to the guard module**

Append to `supabase/functions/_shared/ssrf-guard.ts`:

```ts
/**
 * GET a user- or model-supplied URL and return its body as text.
 *
 * Same protections as safeWebhookPost, plus two this caller needs: a timeout,
 * and a byte cap enforced while streaming. Reading the whole body and slicing
 * afterwards lets a hostile or merely huge page exhaust the isolate's memory
 * before the slice ever runs.
 */
export async function safeFetchText(
  startUrl: string,
  opts: { timeoutMs?: number; maxBytes?: number } = {},
): Promise<string> {
  const { timeoutMs = 10_000, maxBytes = 2_000_000 } = opts;
  let url = startUrl;

  for (let hop = 0; hop < 3; hop++) {
    if (!isSafeOutboundUrl(url)) {
      throw new Error("refused: URL is not a public https address");
    }
    const res = await fetch(url, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "User-Agent": "Menerio/1.0 (+https://menerio.com)" },
    });

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      await res.body?.cancel();
      if (!loc) throw new Error("refused: redirect without a location");
      url = new URL(loc, url).toString(); // re-validated at the top of the next hop
      continue;
    }
    if (!res.ok) throw new Error(`fetch failed: ${res.status}`);

    const reader = res.body?.getReader();
    if (!reader) return "";
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (total < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.length;
    }
    await reader.cancel().catch(() => {});
    const buf = new Uint8Array(total);
    let at = 0;
    for (const c of chunks) {
      buf.set(c.subarray(0, Math.min(c.length, total - at)), at);
      at += c.length;
      if (at >= total) break;
    }
    return new TextDecoder().decode(buf);
  }
  throw new Error("refused: too many redirects");
}
```

- [ ] **Step 4: Route `fetchUrlAsText` through it**

In `supabase/functions/_shared/collection-schema.ts`, add the import at the top:

```ts
import { safeFetchText } from "./ssrf-guard.ts";
```

Replace lines 115-122 (the `fetch` and `res.text()`) so the function body starts:

```ts
/**
 * Fetch a URL and return trimmed text (~15KB budget). Used by
 * extract_item_from_url, whose `url` argument is chosen by the MODEL — so note
 * content can steer it. It therefore gets the full outbound guard: https only,
 * no internal hosts, every redirect hop re-checked, a timeout, and a byte cap.
 */
export async function fetchUrlAsText(url: string, maxChars = 15000): Promise<string> {
  const html = await safeFetchText(url);
  // Naive HTML -> text; good enough for structured extraction context.
  const stripped = html
```

The rest of the function (the `.replace` chain and `return stripped.slice(0, maxChars)`) is unchanged.

- [ ] **Step 5: Verify no other caller regressed**

Run: `npx vitest run` → all green.
Run: `npm run lint` → clean.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/_shared/ssrf-guard.ts supabase/functions/_shared/collection-schema.ts supabase/functions/_shared/__tests__/ssrf-guard.test.ts
git commit -m "fix(security): guard fetchUrlAsText against SSRF

extract_item_from_url passes a model-chosen URL straight to fetch() with
redirect:follow, no scheme or host check, no timeout and no size cap. Route it
through the existing ssrf-guard and pin that guard with tests."
```

---

### Task 5: Make the credit gate actually gate `runChat`

**Files:**
- Modify: `supabase/functions/_shared/llm-router.ts:355-516`

**Interfaces:**
- Consumes: `checkBalance(db, userId): Promise<BalanceCheck>`, `deductTokens`, `isBalanceUnavailable` from `_shared/llm-credits.ts`.
- Produces: `runChat` gains one field on `RunChatResult`: `deductFailed?: boolean`. It now throws `Error("INSUFFICIENT_CREDITS")` or `Error("BALANCE_UNAVAILABLE")` **before** contacting a provider when the balance is empty or unreadable.

**This is the billing path — read this before writing code.** The change makes `runChat` fail **closed** on a pre-check, matching `openRouterWithCredits`, which has always worked this way. It deliberately does **not** fail closed on the post-call deduction: the provider has already been paid by then, so discarding the answer would charge the money and throw the value away. Instead the deduct failure becomes a `console.error` plus a `deductFailed` flag, so it is visible rather than silent. The net effect: a user at zero balance is stopped before the spend, and a deduction that fails after a successful spend is loud.

`skipDeduct: true` (the admin test-run path) also skips the pre-check, which is the existing intent — admins testing a call site should not be gated. That is called out in the code comment so it is a decision, not an oversight.

- [ ] **Step 1: Add the pre-check**

In `supabase/functions/_shared/llm-router.ts`, add to the imports on line 10:

```ts
import { checkBalance, deductTokens, type CreditInfo } from "./llm-credits.ts";
```

Add `deductFailed` to the `RunChatResult` interface (after line 44):

```ts
export interface RunChatResult {
  content: string;
  raw: unknown;
  credits?: CreditInfo;
  configSource: "db" | "fallback-default";
  model: string;
  provider: Provider;
  /** True when the provider was paid but the ledger could not record it. */
  deductFailed?: boolean;
}
```

Insert immediately after `const { effective, source } = await resolveConfig(...)` (line 377):

```ts
  // Check the balance BEFORE contacting a provider.
  //
  // openRouterWithCredits has always pre-checked. runChat did not: it called
  // the provider, then deducted inside a try/catch that only warned. So a user
  // at zero balance kept getting answers — the deduction threw
  // INSUFFICIENT_CREDITS, the warning scrolled past, and the content was
  // returned anyway. The ledger was advisory on the one path every migrated
  // call site uses.
  //
  // skipDeduct also skips this: that flag is the admin test-run, which is meant
  // to bypass the gate.
  if (!args.skipDeduct) {
    const balance = await checkBalance(args.db, args.userId);
    if (!balance.allowed) {
      const err: any = new Error(
        balance.unavailable ? "BALANCE_UNAVAILABLE" : "INSUFFICIENT_CREDITS",
      );
      err.creditInfo = balance;
      throw err;
    }
  }
```

- [ ] **Step 2: Make the post-call deduct failure loud instead of silent**

Replace the `catch` on lines 503-505 with:

```ts
    } catch (err) {
      // The provider has already been paid at this point, so we return the
      // answer rather than binning work the user was charged for upstream. But
      // this must never be quiet: it means real spend went unrecorded.
      deductFailed = true;
      console.error(
        `[llm-router] SPEND NOT RECORDED for ${args.callSite} ` +
          `(user=${args.userId}, model=${effective.model}, tokens=${total}): ` +
          `${(err as Error).message}`,
      );
    }
```

Declare the flag beside `credits` (line 474):

```ts
  let credits: CreditInfo | undefined;
  let deductFailed = false;
```

And return it (line 508-515):

```ts
  return {
    content,
    raw: result,
    credits,
    configSource: source,
    model: effective.model,
    provider: effective.provider,
    deductFailed,
  };
```

- [ ] **Step 3: Harden the provider switch**

The `switch (provider)` on line 387 has no `default`. Every value the DB permits is currently handled, so this is unreachable today — but if it ever is reached, `result` stays `undefined` and line 471 turns that into `content: ""`, i.e. a silent empty answer rather than an error. Add after the `gemini` case (line 468):

```ts
    default: {
      // Unreachable while llm_call_configs_provider_chk matches the Provider
      // union. If that drifts, fail loudly — returning "" would look like the
      // model simply had nothing to say.
      throw new Error(`Unknown LLM provider '${provider}' for ${args.callSite}`);
    }
```

- [ ] **Step 4: Verify the 8 unguarded call sites now inherit the gate**

These call `runChat` with no balance check of their own, and after Step 1 they no longer need one: `admin-llm-config`, `ai-moderate-content`, `classify-profile-fact`, `daily-digest`, `generate-profile-suggestions`, `profile-audit`, `wiki-ingest`, `wiki-restructure`.

Confirm none of them treat a thrown error as success:

```bash
for f in admin-llm-config ai-moderate-content classify-profile-fact daily-digest \
         generate-profile-suggestions profile-audit wiki-ingest wiki-restructure; do
  echo "--- $f"; grep -n "runChat" -A6 "supabase/functions/$f/index.ts"
done
```

Expected: each `await runChat(...)` sits inside a `try` that logs and returns a non-success result, or propagates. Any site that swallows the throw and continues needs a one-line fix to surface `INSUFFICIENT_CREDITS` / `BALANCE_UNAVAILABLE` — `insufficientCreditsResponse` and `balanceUnavailableResponse` in `_shared/llm-credits.ts` already build the 402 and 503.

- [ ] **Step 5: Lint, build, commit**

Run: `npm run lint && npm run build` → clean.

```bash
git add supabase/functions/_shared/llm-router.ts
git commit -m "fix(billing): enforce the credit gate in runChat

runChat called the provider first and deducted inside a swallowed try/catch, so
a zero balance never stopped a call. Pre-check before spending (as
openRouterWithCredits already did), and make an unrecorded spend an error-level
log instead of a warning nobody reads."
```

- [ ] **Step 6: Verify live, after deploy**

This is the change most worth proving against the real system. With the function deployed:

1. In the Supabase SQL editor, read the current allowance:
   `select remaining_tokens, remaining_credits, period_start from v_ai_allowance_current where user_id = '4332607c-1ddd-4a5d-8765-a44963e4fe12';`
2. Trigger a `runChat` call site (save a note long enough to process).
3. Confirm `llm_usage_events` gained a row and `remaining_tokens` dropped.
4. **The test that distinguishes "the fix worked" from "the code path never ran":** confirm the token delta is non-zero. A pre-check that throws and a call site that was never reached both leave the balance unchanged; only a completed, recorded call moves it.

---

### Task 6: Never destroy a note's chunks for a partial replacement

**Files:**
- Modify: `supabase/functions/_shared/chunk-embeddings.ts:20-106`
- Create: `supabase/functions/_shared/__tests__/chunk-embeddings.test.ts`

**Interfaces:**
- Consumes: `getEmbeddingWithCredits`, `smartChunkMarkdown`, `buildEmbeddingInput`.
- Produces: `ChunkEmbedResult` gains `attempted: number` and `replaced: boolean`. `chunkCount` now means **rows actually inserted**. Callers `backfill-embeddings/index.ts:100`, `process-note/index.ts:2429` and `menerio-mcp/index.ts:982` keep working — `chunkCount === 0` still means "nothing landed", it is just now true.

The fix is to embed everything **first**, into memory, and only touch the database once every chunk has a vector. 50 chunks × 1536 floats is under a megabyte, so buffering is cheap. A run that stops early then leaves the previous chunks exactly as they were, which is the behaviour the existing comment claims but does not deliver.

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/_shared/__tests__/chunk-embeddings.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";

const getEmbedding = vi.fn();
vi.mock("../llm-credits.ts", () => ({
  getEmbeddingWithCredits: (...a: unknown[]) => getEmbedding(...a),
}));

import { embedAndStoreNoteChunks } from "../chunk-embeddings.ts";

const del = vi.fn();
const insert = vi.fn();

function fakeAdmin() {
  return { from: () => ({ delete: () => ({ eq: del }), insert }) };
}

const LONG = Array.from({ length: 40 }, (_, i) => `## Heading ${i}\n\nBody ${i}. `.repeat(20)).join("\n\n");

beforeEach(() => {
  del.mockReset().mockResolvedValue({ error: null });
  insert.mockReset().mockResolvedValue({ error: null });
  getEmbedding.mockReset();
});

describe("embedAndStoreNoteChunks", () => {
  it("keeps the existing chunks when embedding stops part-way", async () => {
    getEmbedding
      .mockResolvedValueOnce({ embedding: [0.1], credits: { remaining_credits: 5 } })
      .mockRejectedValue(new Error("INSUFFICIENT_CREDITS"));

    const res = await embedAndStoreNoteChunks(fakeAdmin(), "k", "u1", "n1", "T", LONG, "f");

    // Nothing was replaced, so the note keeps whatever it already had.
    expect(del).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
    expect(res.replaced).toBe(false);
    expect(res.insufficientCredits).toBe(true);
  });

  it("reports the number of chunks actually written, not the number planned", async () => {
    getEmbedding
      .mockResolvedValueOnce({ embedding: [0.1], credits: { remaining_credits: 5 } })
      .mockRejectedValue(new Error("INSUFFICIENT_CREDITS"));

    const res = await embedAndStoreNoteChunks(fakeAdmin(), "k", "u1", "n1", "T", LONG, "f");

    // The bug: chunkCount was `limited.length - failures`, computed from the
    // whole plan even though the loop broke on chunk 1 — so a run that stored
    // nothing reported dozens of chunks.
    expect(res.chunkCount).toBe(0);
    expect(res.attempted).toBeGreaterThan(1);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run supabase/functions/_shared/__tests__/chunk-embeddings.test.ts`
Expected: FAIL — `del` was called once (old chunks already destroyed) and `chunkCount` is a large number.

- [ ] **Step 3: Rewrite the body to embed first, write once**

Replace lines 39-105 of `supabase/functions/_shared/chunk-embeddings.ts` with:

```ts
  // Embed EVERY chunk before touching the database.
  //
  // The previous version deleted the old chunks as soon as the first embedding
  // succeeded, then inserted the rest one at a time. Deferring the delete that
  // far protected only the total-failure case: if chunk 0 succeeded and chunk 1
  // ran out of credits, the old chunks were already gone and the note was left
  // holding one. Buffering first means a partial run changes nothing at all,
  // which is what "keep the stale chunks until a real replacement exists"
  // actually requires. 50 chunks of 1536 floats is well under a megabyte.
  let failures = 0;
  let attempted = 0;
  let remainingCredits: number | null = null;
  let insufficientCredits = false;
  let balanceUnavailable = false;
  const embedded: Array<{ chunk: NoteChunk; embedding: number[] }> = [];

  for (const chunk of limited) {
    attempted += 1;
    const input = buildEmbeddingInput(noteTitle, chunk);
    try {
      const { embedding, credits } = await getEmbeddingWithCredits(
        admin, openrouterApiKey, userId, feature, input,
      );
      remainingCredits = credits?.remaining_credits ?? remainingCredits;
      embedded.push({ chunk, embedding });
    } catch (err) {
      const msg = (err as Error).message || String(err);
      console.warn("chunk embedding failed", noteId, chunk.index, msg);
      failures += 1;
      if (msg === "BALANCE_UNAVAILABLE") {
        balanceUnavailable = true;
        break;
      }
      if (msg === "INSUFFICIENT_CREDITS" || msg.toLowerCase().includes("insufficient")) {
        insufficientCredits = true;
        break;
      }
    }
  }

  // A partial set is not a replacement. Leave the note's existing chunks alone
  // and report honestly, so the caller can retry rather than believe it indexed.
  const complete = embedded.length === limited.length;
  if (!complete) {
    console.warn(
      `note_chunks NOT replaced for ${noteId}: embedded ${embedded.length}/${limited.length}`,
    );
    return {
      chunkCount: 0,
      attempted,
      replaced: false,
      truncated,
      failures,
      firstChunkEmbedding: embedded.find((e) => e.chunk.index === 0)?.embedding ?? null,
      remainingCredits,
      insufficientCredits,
      balanceUnavailable,
    };
  }

  await admin.from("note_chunks").delete().eq("note_id", noteId);
  let inserted = 0;
  let writeFailures = 0;
  for (const { chunk, embedding } of embedded) {
    const { error } = await admin.from("note_chunks").insert({
      note_id: noteId,
      user_id: userId,
      chunk_index: chunk.index,
      heading_path: chunk.headingPath || null,
      content: chunk.content,
      token_count: chunk.tokenCount,
      embedding,
    });
    if (error) {
      console.warn("note_chunks insert error", noteId, chunk.index, error.message);
      writeFailures += 1;
    } else {
      inserted += 1;
    }
  }

  return {
    chunkCount: inserted,
    attempted,
    replaced: true,
    truncated,
    failures: failures + writeFailures,
    firstChunkEmbedding: embedded.find((e) => e.chunk.index === 0)?.embedding ?? null,
    remainingCredits,
    insufficientCredits,
    balanceUnavailable,
  };
```

Update the interface (lines 9-18) to add the two new fields:

```ts
export interface ChunkEmbedResult {
  /** Rows actually written to note_chunks. Zero when nothing was replaced. */
  chunkCount: number;
  /** Chunks we tried to embed, whether or not they succeeded. */
  attempted: number;
  /** True only when the note's chunks were genuinely swapped for a full new set. */
  replaced: boolean;
  truncated: boolean;
  failures: number;
  firstChunkEmbedding: number[] | null;
  remainingCredits?: number | null;
  insufficientCredits?: boolean;
  /** The allowance could not be read at all. Distinct from a spent quota. */
  balanceUnavailable?: boolean;
}
```

And the early return on line 36 (empty note) becomes:

```ts
    return { chunkCount: 0, attempted: 0, replaced: true, truncated: false, failures: 0, firstChunkEmbedding: null };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run supabase/functions/_shared/__tests__/chunk-embeddings.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Check the three callers still read correctly**

```bash
grep -n "chunkCount\|chunkResult\|res.failures" \
  supabase/functions/backfill-embeddings/index.ts \
  supabase/functions/process-note/index.ts \
  supabase/functions/menerio-mcp/index.ts
```

`backfill-embeddings:100` (`chunks_created += result.chunkCount`) and `menerio-mcp:982` (`res.failures > 0 && res.chunkCount === 0`) both become *more* accurate with no edit. `process-note:2429` reports `count: chunkResult.chunkCount` — leave as is.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/_shared/chunk-embeddings.ts supabase/functions/_shared/__tests__/chunk-embeddings.test.ts
git commit -m "fix(embeddings): never replace a note's chunks with a partial set

The delete fired after the first successful embedding, so a mid-run credit
failure left the note holding one chunk instead of its previous full set. And
chunkCount was computed from the plan, not the writes, so a run that stored
nothing could report 49 chunks. Embed everything first, write once, count rows."
```

---

### Task 7: Let `compute-connections` accept the internal caller

**Files:**
- Modify: `supabase/functions/compute-connections/index.ts:29-36`
- Modify: `supabase/functions/process-note/index.ts:2682-2691`

**Interfaces:**
- Consumes: nothing new.
- Produces: `compute-connections` accepts either a user JWT (unchanged) or the service-role key plus an explicit `user_id` in the body, mirroring the `isInternal` pattern already in `process-note/index.ts:2732`.

- [ ] **Step 1: Reproduce the silent 401**

With the functions deployed, in the Supabase SQL editor pick a note that the sweep processed, then check whether it has connections:

```sql
select n.id, n.title, n.processing_status,
       (select count(*) from note_connections c
         where c.source_note_id = n.id or c.target_note_id = n.id) as connections
from notes n
where n.user_id = '4332607c-1ddd-4a5d-8765-a44963e4fe12'
  and n.processing_status = 'processed'
order by n.updated_at desc
limit 20;
```

Expected before the fix: notes processed through the sweep show `connections = 0` while notes saved with the editor open show non-zero. That difference is the bug.

- [ ] **Step 2: Accept an internal caller in `compute-connections`**

Replace lines 29-36 of `supabase/functions/compute-connections/index.ts`:

```ts
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "unauthorized" }, 401);
    const token = authHeader.replace("Bearer ", "").trim();

    const body = await req.json();
    const { note_id } = body;
    if (!note_id) return json({ error: "note_id required" }, 400);

    // Two callers, two credentials.
    //
    // A person saving a note arrives with a user JWT. But process-note fans out
    // to here with whatever Authorization it was itself called with, and the
    // sweep and the post-OCR re-trigger call process-note with the SERVICE ROLE
    // KEY. A service-role key is not a user JWT, so getUser() rejected it and
    // this returned 401 — and because the fan-out is a bare fetch().catch(),
    // an HTTP 401 resolves normally and nothing was ever logged. Every note the
    // sweep rescued silently got no connections at all.
    let userId: string;
    if (token === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) {
      const { data: owner } = await supabase
        .from("notes")
        .select("user_id")
        .eq("id", note_id)
        .single();
      if (!owner) return json({ error: "Note not found" }, 404);
      userId = owner.user_id;
    } else {
      const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
      if (authErr || !user) return json({ error: "unauthorized" }, 401);
      userId = user.id;
    }
```

Then replace the later `.eq("user_id", user.id)` on the note fetch with `.eq("user_id", userId)`, and every other `user.id` in the handler with `userId`:

```bash
grep -n "user\.id" supabase/functions/compute-connections/index.ts
```

Expected after editing: no matches.

- [ ] **Step 3: Stop the fan-out from swallowing a non-2xx**

In `supabase/functions/process-note/index.ts`, replace lines 2682-2691:

```ts
    // Trigger connection computation (fire-and-forget, but never silent: a
    // fetch() only rejects on a transport error, so an HTTP 4xx/5xx from the
    // callee used to vanish without a log line).
    const computeUrl = `${SUPABASE_URL}/functions/v1/compute-connections`;
    fetch(computeUrl, {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ note_id: noteId }),
    })
      .then(async (r) => {
        if (!r.ok) {
          console.error(
            `compute-connections rejected note=${noteId}: ${r.status} ${await r.text().catch(() => "")}`,
          );
        }
      })
      .catch((err) => console.error("compute-connections trigger error:", err));
```

- [ ] **Step 4: Lint and build**

Run: `npm run lint && npm run build` → clean.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/compute-connections/index.ts supabase/functions/process-note/index.ts
git commit -m "fix(graph): compute connections for notes processed internally

process-note passes its own Authorization down to compute-connections, and the
sweep and post-OCR re-trigger call it with the service-role key, which is not a
user JWT. compute-connections 401'd, the fire-and-forget fetch resolved fine on
a 401, and nothing logged it, so swept notes silently never joined the graph."
```

- [ ] **Step 6: Verify live**

After deploy, re-run the SQL from Step 1, then force one note through the sweep:

```bash
# with a real user JWT
curl -X POST "https://tjeapelvjlmbxafsmjef.supabase.co/functions/v1/sweep-note-processing" \
  -H "Authorization: Bearer <USER_JWT>" -H "Content-Type: application/json" -d '{"limit":1}'
```

Then re-run the query. Expected: the swept note's `connections` count is now non-zero, and the edge function log shows no `compute-connections rejected` line. A count that stays zero **and** a log line saying it was rejected is a different failure from a count that stays zero with no log at all — the first means the fix landed and something else is wrong, the second means the code path never ran.

---

### Task 8: Stop "fetch everything" from meaning "the first 1000 rows"

**Files:**
- Create: `supabase/functions/_shared/paged-select.ts`
- Create: `supabase/functions/_shared/__tests__/paged-select.test.ts`
- Modify: `src/sync/local-replica.ts:108-127`
- Modify: `supabase/functions/recompute-all-connections/index.ts:59-65`

**Interfaces:**
- Produces: `selectAllRows<T>(buildQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>, pageSize?: number): Promise<T[]>`.

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/_shared/__tests__/paged-select.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { selectAllRows } from "../paged-select.ts";

describe("selectAllRows", () => {
  it("pages past the PostgREST row cap", async () => {
    const all = Array.from({ length: 2300 }, (_, i) => ({ id: i }));
    const rows = await selectAllRows<{ id: number }>(
      async (from, to) => ({ data: all.slice(from, to + 1), error: null }),
      1000,
    );
    expect(rows).toHaveLength(2300);
    expect(rows[2299].id).toBe(2299);
  });

  it("stops on a short page", async () => {
    let calls = 0;
    const rows = await selectAllRows<{ id: number }>(async () => {
      calls += 1;
      return { data: [{ id: 1 }], error: null };
    }, 1000);
    expect(rows).toHaveLength(1);
    expect(calls).toBe(1);
  });

  it("throws the underlying error rather than returning a short list", async () => {
    await expect(
      selectAllRows(async () => ({ data: null, error: { message: "boom" } }), 1000),
    ).rejects.toBeTruthy();
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run supabase/functions/_shared/__tests__/paged-select.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the helper**

Create `supabase/functions/_shared/paged-select.ts`:

```ts
/**
 * Read every row a query matches, not the first page of them.
 *
 * PostgREST caps an unbounded select (Supabase defaults to 1000 rows) and says
 * nothing about it, so `.select(...)` with no `.range()` silently means "up to
 * 1000". Code that then counts the result, or diffs it against another set, is
 * wrong the moment the table outgrows the cap — and wrong in the quiet
 * direction, because the short list looks like a complete answer.
 */
export async function selectAllRows<T>(
  buildQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  pageSize = 1000,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await buildQuery(from, from + pageSize - 1);
    if (error) throw error;
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < pageSize) return out;
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run supabase/functions/_shared/__tests__/paged-select.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Fix the replica diagnostic**

In `src/sync/local-replica.ts`, the server-side select inside `getReplicaDiagnostics` (lines 113-117) must page. Because this file is frontend code it cannot import the Deno helper — inline the same loop, which is four lines:

```ts
  const [localCounts, serverRows, uploadStats] = await Promise.all([
    db.get<{ total: number; favorites: number }>(
      "SELECT count(*) AS total, sum(case when is_favorite = 1 then 1 else 0 end) AS favorites FROM notes WHERE user_id = ? AND is_trashed = 0",
      [userId],
    ),
    // Paged deliberately. An unbounded select stops at PostgREST's 1000-row
    // cap, so past 1000 notes serverTotal pinned at 1000 and missingIds was
    // diffed against a partial set — the check that exists to catch a broken
    // replica became the thing hiding one. repairLocalReplica below already
    // pages; this did not.
    (async () => {
      const rows: { id: string; is_favorite: boolean }[] = [];
      const pageSize = 1000;
      for (let from = 0; ; from += pageSize) {
        const { data, error } = await supabase
          .from("notes" as never)
          .select("id, is_favorite")
          .eq("user_id", userId)
          .eq("is_trashed", false)
          .order("id", { ascending: true })
          .range(from, from + pageSize - 1);
        if (error) throw error;
        const page = (data as unknown as { id: string; is_favorite: boolean }[]) || [];
        rows.push(...page);
        if (page.length < pageSize) return rows;
      }
    })(),
    db.getUploadQueueStats().catch(() => ({ count: 0 })),
  ]);

  const server = serverRows;
```

Delete the now-redundant line 121 (`const server = ((serverRows.data as unknown as ...) || []);`) — it is replaced by the `const server = serverRows;` above.

- [ ] **Step 6: Fix the user enumeration in `recompute-all-connections`**

In `supabase/functions/recompute-all-connections/index.ts`, add the import:

```ts
import { selectAllRows } from "../_shared/paged-select.ts";
```

Replace lines 59-65:

```ts
    // Every user who has a note — not "every user among the first 1000 note
    // rows", which is what an unbounded select returns. One prolific user's
    // notes used to fill the page and crowd everyone else out of the recompute.
    const userRows = await selectAllRows<{ user_id: string }>((from, to) =>
      supabase
        .from("notes")
        .select("user_id")
        .eq("is_trashed", false)
        .order("user_id", { ascending: true })
        .range(from, to),
    );
    const uniqueUsers = [...new Set(userRows.map((r) => r.user_id))];
```

- [ ] **Step 7: Run everything and commit**

Run: `npx vitest run && npm run lint && npm run build` → all green.

```bash
git add supabase/functions/_shared/paged-select.ts \
        supabase/functions/_shared/__tests__/paged-select.test.ts \
        src/sync/local-replica.ts \
        supabase/functions/recompute-all-connections/index.ts
git commit -m "fix: page the two selects that meant to read every row

PostgREST caps an unbounded select at 1000 rows silently. The replica
diagnostic diffed against a partial server list, and 'recompute for all users'
enumerated users from the first 1000 note rows."
```

---

### Task 9: One escaping helper for PostgREST filters, adopted everywhere

**Files:**
- Create: `supabase/functions/_shared/postgrest-filters.ts`
- Create: `supabase/functions/_shared/__tests__/postgrest-filters.test.ts`
- Modify: `supabase/functions/{hub-api-contacts,hub-api-notes,search-notes-semantic,menerio-mcp}/index.ts`, `supabase/functions/_shared/read-tools.ts`, `src/pages/CollectionDetail.tsx`

**Interfaces:**
- Produces: `escapeLike`, `pgOrValue`, `ilikeContains(column: string, q: string): string` — byte-identical semantics to `src/lib/postgrest.ts`, which already has passing tests.

Only the sites interpolating **user text** change. The `.or()` calls carrying UUIDs and timestamps are out of scope and listed in the Findings section.

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/_shared/__tests__/postgrest-filters.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { escapeLike, pgOrValue, ilikeContains } from "../postgrest-filters.ts";

describe("escapeLike", () => {
  it("escapes LIKE metacharacters", () => {
    expect(escapeLike("50%")).toBe("50\\%");
    expect(escapeLike("a_b")).toBe("a\\_b");
    expect(escapeLike("c:\\path")).toBe("c:\\\\path");
  });
  it("leaves ordinary text alone", () => {
    expect(escapeLike("hello world")).toBe("hello world");
  });
});

describe("pgOrValue", () => {
  it("quotes values containing the or() grammar", () => {
    expect(pgOrValue("a,b")).toBe('"a,b"');
    expect(pgOrValue("Q1 (draft)")).toBe('"Q1 (draft)"');
  });
  it("escapes quotes and backslashes", () => {
    expect(pgOrValue('a"b')).toBe('"a\\"b"');
    expect(pgOrValue("a\\b")).toBe('"a\\\\b"');
  });
});

describe("ilikeContains", () => {
  it("survives a search term containing a comma", () => {
    // Unquoted this becomes two conditions and PostgREST 400s the request.
    expect(ilikeContains("title", "Smith, John")).toBe('title.ilike."%Smith, John%"');
  });
  it("does not let a term's wildcards change the match", () => {
    expect(ilikeContains("title", "100%")).toBe('title.ilike."%100\\\\%%"');
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run supabase/functions/_shared/__tests__/postgrest-filters.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the Deno-side helper**

Create `supabase/functions/_shared/postgrest-filters.ts`:

```ts
/**
 * Helpers for safely embedding user input into PostgREST filters.
 *
 * This is the edge-function twin of `src/lib/postgrest.ts`. The two cannot be
 * one file: the frontend builds through Vite with `@/` aliases and the edge
 * functions are Deno modules resolved by URL. Keep the two in step — if you
 * change one, change the other and both test files.
 *
 * Two distinct hazards:
 *  1. LIKE/ILIKE wildcards — `%` and `_` in user text are pattern
 *     metacharacters. escapeLike() makes them match literally.
 *  2. The `.or()` / `.and()` filter *grammar* — `,` separates conditions and
 *     `(` `)` group them, so a value containing those breaks parsing. A search
 *     for "Smith, John" became two conditions and returned a 400.
 */

/** Escape LIKE/ILIKE wildcards so user input matches literally within a pattern. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Quote a value for safe embedding inside a PostgREST `.or()`/`.and()` filter
 * string. Wrapping in double quotes lets the value contain `,` `.` `:` `(` `)`
 * and spaces; internal backslashes and double quotes are escaped.
 */
export function pgOrValue(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** Build a safe `column.ilike.<quoted>` fragment matching text that CONTAINS `q`. */
export function ilikeContains(column: string, q: string): string {
  return `${column}.ilike.${pgOrValue(`%${escapeLike(q)}%`)}`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run supabase/functions/_shared/__tests__/postgrest-filters.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Adopt it at every site taking user text**

Add `import { ilikeContains } from "../_shared/postgrest-filters.ts";` (or `"./postgrest-filters.ts"` inside `_shared`) to each file, then rewrite:

| File:line | From | To |
|---|---|---|
| `hub-api-contacts:141` | `` .or(`name.ilike.%${search}%,email.ilike.%${search}%,company.ilike.%${search}%`) `` | ``.or([ilikeContains("name", search), ilikeContains("email", search), ilikeContains("company", search)].join(","))`` |
| `hub-api-notes:79` | `` .or(`title.ilike.%${query}%,content.ilike.%${query}%`) `` | ``.or([ilikeContains("title", query), ilikeContains("content", query)].join(","))`` |
| `search-notes-semantic:35` | `` .or(`title.ilike.%${q}%,content.ilike.%${q}%`) `` | ``.or([ilikeContains("title", q), ilikeContains("content", q)].join(","))`` |
| `menerio-mcp:664` | `` .or(`title.ilike.*${q}*,content.ilike.*${q}*`) `` | ``.or([ilikeContains("title", q), ilikeContains("content", q)].join(","))`` |
| `menerio-mcp:749` | `` .or(`title.ilike.*${q}*,slug.ilike.*${q}*,content.ilike.*${q}*`) `` | ``.or([ilikeContains("title", q), ilikeContains("slug", q), ilikeContains("content", q)].join(","))`` |
| `menerio-mcp:1439` | `` .or(`name.ilike.*${qq}*,company.ilike.*${qq}*`) `` | ``.or([ilikeContains("name", qq), ilikeContains("company", qq)].join(","))`` |
| `menerio-mcp:1750` | `` .or(`title.ilike.*${escaped}*,description.ilike.*${escaped}*`) `` | ``.or([ilikeContains("title", query), ilikeContains("description", query)].join(","))`` — **and delete the `const escaped = query.replace(/[,()'"\\*%_]/g, " ")...` line above it**, which silently turned a search for `Q1 (draft)` into a search for `Q1 draft` |
| `menerio-mcp:2681` | `` .or(`title.ilike.*${q}*,slug.ilike.*${q}*,content.ilike.*${q}*`) `` | ``.or([ilikeContains("title", q), ilikeContains("slug", q), ilikeContains("content", q)].join(","))`` |
| `_shared/read-tools.ts:213` | `` .or(`title.ilike.%${q}%,content.ilike.%${q}%`) `` | ``.or([ilikeContains("title", q), ilikeContains("content", q)].join(","))`` |
| `_shared/read-tools.ts:233` | `` .or(`extracted_text.ilike.%${q}%,description.ilike.%${q}%`) `` | ``.or([ilikeContains("extracted_text", q), ilikeContains("description", q)].join(","))`` |

For the frontend site, import from the existing module — do **not** add a second copy:

`src/pages/CollectionDetail.tsx:911` — add `import { ilikeContains } from "@/lib/postgrest";` and change:

```tsx
        const { data } = term
          ? await request.or([ilikeContains("title", term), ilikeContains("content", term)].join(","))
          : await request;
```

- [ ] **Step 6: Confirm no unescaped user-text interpolation is left**

```bash
grep -rn '\.or(`[^`]*ilike[^`]*\${' src supabase/functions --include=*.ts --include=*.tsx
```

Expected: no matches. Any hit is a site that still concatenates a search term by hand.

- [ ] **Step 7: Run everything and commit**

Run: `npx vitest run && npm run lint && npm run build` → all green.

```bash
git add supabase/functions/_shared/postgrest-filters.ts \
        supabase/functions/_shared/__tests__/postgrest-filters.test.ts \
        supabase/functions/hub-api-contacts/index.ts \
        supabase/functions/hub-api-notes/index.ts \
        supabase/functions/search-notes-semantic/index.ts \
        supabase/functions/menerio-mcp/index.ts \
        supabase/functions/_shared/read-tools.ts \
        src/pages/CollectionDetail.tsx
git commit -m "fix(search): escape user text before putting it in a PostgREST or() filter

A search term containing a comma or a parenthesis was parsed as extra filter
conditions and 400'd the request. src/lib/postgrest.ts already solved this and
was used three times; add the Deno twin and adopt both at every site that takes
user text, replacing menerio-mcp's lossy strip-the-characters workaround."
```

---

### Task 10: Claim a note before processing it

**Files:**
- Modify: `supabase/functions/process-note/index.ts:2302-2356`
- Create: `supabase/rollback/2026-08-17-audit-fixes-rollback.sql`

**Interfaces:**
- Consumes: nothing new.
- Produces: `claimNoteForProcessing(noteId: string, contentHash: string): Promise<boolean>` — true when this invocation won the claim.

`process-note`'s own comment says "the client flush and the server sweep can both fire" (`index.ts:2337-2338`). The content-hash check handles the *sequential* case — a run that starts after another finished. It cannot handle the *concurrent* case: two invocations both read `processing_status` before either writes it, both pass the check, both spend credits on the same note. `setProcessingState` is an unconditional `update` (line 2308), so there is no claim.

- [ ] **Step 1: Add a conditional claim**

In `supabase/functions/process-note/index.ts`, add after `setProcessingState` (line 2313):

```ts
/**
 * Take exclusive ownership of a note before spending anything on it.
 *
 * The content-hash check above stops a re-run of a version we already finished.
 * It cannot stop two runs starting at once — the client flush and the sweep
 * both fire, both read a status that is not yet "processing", both proceed, and
 * the note is embedded and extracted twice at double the credit cost. The
 * `.neq("processing_status", "processing")` turns the read-then-write into a
 * single conditional update: exactly one caller gets a row back.
 *
 * Returns false when someone else already holds the claim.
 */
async function claimNoteForProcessing(noteId: string, contentHash: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("notes")
    .update({ processing_status: "processing", processing_error: null })
    .eq("id", noteId)
    .neq("processing_status", "processing")
    .select("id");
  if (error) {
    console.warn("failed to claim note for processing", noteId, error.message);
    return false;
  }
  const won = Array.isArray(data) && data.length > 0;
  if (!won) {
    console.log(`process-note: note ${noteId} is already being processed (hash ${contentHash})`);
  }
  return won;
}
```

- [ ] **Step 2: Use it instead of the unconditional state write**

Replace line 2356 (`await setProcessingState(noteId, "processing", { processing_error: null });`) with:

```ts
    if (!force && !(await claimNoteForProcessing(noteId, contentHash))) return;
    if (force) await setProcessingState(noteId, "processing", { processing_error: null });
```

`force: true` is the deliberate admin re-run and keeps its existing override.

- [ ] **Step 3: Guard against a stuck claim**

A run that dies mid-flight leaves `processing_status = 'processing'` forever, and the new claim would refuse every retry. `sweep-note-processing` already looks for stuck runs — confirm its cutoff covers this:

```bash
grep -n "SETTLE_MS\|processing_status\|cutoff" supabase/functions/sweep-note-processing/index.ts
```

Expected: the sweep's candidate query already includes notes stuck in `processing` older than its settle window. If it does not, add `processing` older than 15 minutes to that query — a claim with no expiry is a deadlock.

- [ ] **Step 4: Write the rollback**

Create `supabase/rollback/2026-08-17-audit-fixes-rollback.sql`:

```sql
-- Rollback for the 2026-08-17 audit fixes.
--
-- None of the ten code fixes ships a migration: every change is in edge
-- function or frontend code, so the rollback for those is `git revert` of the
-- listed commits followed by a redeploy. This file exists for the one piece of
-- STATE a fix can leave behind.
--
-- Task 10 introduces a claim on notes.processing_status. If a deploy is rolled
-- back mid-flight, notes can be left holding a claim nobody will ever release,
-- and the pre-fix code has no notion of clearing one. Release them:

update public.notes
   set processing_status = 'pending',
       processing_error  = null
 where processing_status = 'processing'
   and updated_at < now() - interval '15 minutes';

-- Verify nothing is left stuck:
-- select processing_status, count(*) from public.notes group by 1 order by 2 desc;
```

- [ ] **Step 5: Lint, build, commit**

Run: `npx vitest run && npm run lint && npm run build` → all green.

```bash
git add supabase/functions/process-note/index.ts supabase/rollback/2026-08-17-audit-fixes-rollback.sql
git commit -m "fix(process-note): claim a note before spending credits on it

The content-hash check stops a re-run of a finished version but not two runs
starting at once, which is the exact race the comment above it describes: the
client flush and the sweep both pass the check and both pay to process the same
note. Make the status write a conditional update so only one caller wins."
```

---

## Deploy And Verification

**Deploy order.** Tasks 1, 2, 3 and the `CollectionDetail.tsx` part of Task 9 are frontend — they ship with the normal build, no Lovable turn. Tasks 4, 5, 6, 7, 8, 9, 10 touch edge functions. Batch them into **one** Lovable deploy to conserve credits, one instruction per message, and deploy before touching any row.

**Rollback.** Every fix is code, so `git revert <commit>` plus a redeploy is the rollback for each. The one piece of state is the processing claim from Task 10 — `supabase/rollback/2026-08-17-audit-fixes-rollback.sql` releases it. No fix in this plan alters a live prompt row or deletes data, so no prompt-hash-guarded UPDATE is needed.

**What could break, per task.**

- Task 5 is the one to watch. If the pre-check is too strict, legitimate work stops with `INSUFFICIENT_CREDITS`. Verify by watching `remaining_tokens` actually move (Task 5, Step 6) — a balance that does not move cannot distinguish "gated correctly" from "never ran".
- Task 6 changes what `chunkCount` means. A caller that treated it as "chunks planned" would now see 0 on a partial run — that is the point, but check the three callers listed in Step 5.
- Task 7 grants the service-role caller a path into `compute-connections`. It derives `user_id` from the note row rather than trusting the body, so it cannot be used to compute connections across users.
- Task 10 can deadlock a note if a run dies while holding the claim. Step 3 is not optional.

**Telling "the fix worked" from "the code path never ran".** For each of the three fixes with a live component:

- **Task 5:** the token balance must *decrease* after a call. Unchanged means either gated or never invoked; only a decrease proves the path ran and recorded.
- **Task 7:** the swept note must gain connections *and* the logs must show no `compute-connections rejected` line. Zero connections with a rejection line is a different, later bug; zero with no line means the fan-out never fired.
- **Task 9:** search for a term containing a comma — `Smith, John`. Before the fix it 400s; after, it returns rows. A term with no punctuation proves nothing, because it worked before too.

---

## Out Of Scope

Named so a later reader knows they were considered, not missed: the `hub_api_usage` read-then-write rate-limit race (documented and accepted in `_shared/hub-rate-limit.ts:48-53`); the `llm_usage_events.call_site` patch that uses `.order().limit()` on an UPDATE (already known-unreliable, and an audit should not be built on it); `repairLocalReplica` queueing a full-corpus re-upload that re-fires `process-note` (documented honestly at `local-replica.ts:42-57`, but worth a separate decision because it costs credits); the non-constant-time service-role key comparison at `process-note/index.ts:2732` (a network timing attack on a 40-byte secret is not practical, so this is hardening, not a defect); shared note links having no expiry column.
