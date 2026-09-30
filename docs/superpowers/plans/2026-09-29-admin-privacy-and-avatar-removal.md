# Admin Privacy (Level 1) and Avatar Removal Implementation Plan

**Status (2026-09-30): phases 1 and 2 are live; Task 8 waits for Michael's approval of the wording; Task 11 runs on or after 2026-10-07** (Godspeed obligation `menerio-privacy-phase-3`).

- Tasks 1-7 merged in PR #3 (`06525a75`). Migrations 20261001100000, 100100, 100200, 100300 and 100400 are applied and recorded in `schema_migrations`, each in one transaction with its record. Frontend published through the Lovable deploy; the six functions are deployed.
- Verified live: as the admin session, other users' note chunks, image text, profiles, agent instructions, profile views, categories, activity and notes all read 0 rows; `profile_entries_archive` refuses; the directory returns every account; the Admin page, the Staff access card, the moderation review (live read, logged, no reason text) and a throwaway sign-up and self-deletion all work. Avatars: 0 files, bucket private, no rules, sign-up copies no photo URL.
- Corrections to this plan, made while executing it:
  - The fact-store go-live renamed `profile_entries` to `profile_entries_archive` and the admin rule moved with it; migration D also drops it there.
  - The frontend does not publish on a push to `main`: it reaches menerio.com only through `mcp__lovable__deploy_project` (see `docs/plans/one-fact-store.md`, section 8, "Go-live", item 1). Cherishly is the Vercel project.
  - The Staff access card says "Every action {brand} staff take on your account, and every time our automatic check reads a note you shared publicly, is listed here." The drafted "anything staff or our systems do" overclaimed: scheduled service jobs act on every account and are not logged. The Task 8 draft needs the same correction, and its provider list must match what is configured live (OpenRouter and Mistral), not everything the router supports.
  - `prod-apply.sh` / `prod-read.sh` now exit non-zero on a SQL error.
  - Task 10 Step 7 found that `delete-my-account` and `admin-delete-user` read `SUPABASE_PUBLISHABLE_KEY`, which the hosted runtime does not set, so no account could be deleted. Fixed in PR #4 (`0aa6e46b`).
  - Task 11: the read-only `prod-read.sh` connection may not run `private.assert_no_admin_content_reads()`; query `pg_policies` directly instead.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Menerio staff can no longer read any user's notes, people facts, image text or agent instructions through the app or the API. Every action staff take on an account is logged, and the user can see that log. The unused profile-picture feature and its public storage bucket are gone.

**Architecture:** Row-Level Security stays owner-only, and every admin read rule on user content is dropped. The Admin page gets exactly the account data it needs (name, sign-up date, role, counts) through three `SECURITY DEFINER` functions that check `is_admin` and return only those columns. Moderation stops keeping copies of note text: the AI check reads the note live, and only while it is still publicly shared. An append-only `private.staff_access_log` records every staff or system action on someone else's account, and the user reads their own rows in Settings. A static checker in CI and an apply-time assertion in the migration stop an admin read rule from ever coming back.

**Tech Stack:** Supabase Postgres (RLS, plpgsql, `pg_policies`), Deno edge functions (tested under Vitest where pure), React + Vite + TanStack Query, Vitest + Testing Library, plain `psql` test scripts in the CI `database-permissions` job.

**Spec:** No separate document. The spec is the "Level 1" definition agreed with Michael on 2026-09-29, reproduced here so this plan stands alone:

> Level 1, "staff can't casually read your data":
> 1. Remove the admin read rules on user content (note chunks, image analysis, profile facts and categories, profile views, agent instructions, the moderation copies).
> 2. Admins get only counts, account and billing data.
> 3. Moderation stores a reference to the flagged note, never a copy of its text.
> 4. Log every staff action on someone else's account (the realistic form of "log every time the service key reads user content": the 86 service-role functions acting on the caller's own data are not staff access and are not logged).
> 5. Say plainly in the privacy policy who can technically reach what.
>
> Plus: remove profile pictures (upload in the wizard and Settings, display in Settings and Admin, the public `avatars` bucket, the `profiles.avatar_url` column).
>
> Out of scope (Level 2): end-to-end encryption, a "private vault". Also out of scope: the MCP key accepted in the URL (see "Follow-ups").

## Global Constraints

- Do not start before the one-fact-store go-live (`docs/plans/one-fact-store.md`) has finished or been rolled back. Task 0 checks this. Both plans touch migrations and edge functions, and the go-live deletes `admin-normalize` and stops all writes to `profile_entries`.
- Production SQL only through `scripts/rehearsal/prod-read.sh` (read-only) and `scripts/rehearsal/prod-apply.sh` (writes), project ref `tjeapelvjlmbxafsmjef`. Production reads return **structure and counts only**, never row content (fact-store plan rule 5.1).
- Every applied migration is also recorded in `supabase_migrations.schema_migrations`.
- Functions deploy with `npx supabase@latest functions deploy <names> --project-ref tjeapelvjlmbxafsmjef --use-api`. An edge function bundles its own copy of every `_shared` module it imports, so every function that imports a changed `_shared` file must be redeployed.
- The frontend publishes on push to `main` (Vercel). There is no Lovable step.
- Migration timestamps below start at `20261001100000`. If `main` already has a later migration when you start, shift all six names forward and keep their order.
- User-facing strings: plain words, no em dashes, no "AI-tell" phrases (Michael's voice rules). The privacy-policy text is shown to Michael before it is published (Task 8).
- SQL test scripts refuse to run on any database except their own disposable one, like `scripts/test-share-ownership.sql` does.
- Never print a secret. Scripts that need the service key fetch it at runtime and never log it.

## Review Focus

1. **Tables that no longer exist.** After the fact-store go-live, `profile_entries` / `profile_categories` may be gone or renamed. A `DROP POLICY … ON public.profile_entries` on a missing table aborts the whole migration. Migration D guards every drop with `to_regclass`, and the SQL test omits those tables on purpose to prove the guard works (Task 5).
2. **Live policies that the migration files don't show.** Production has drifted from the repo before (`docs/LIVE_REPAIRS_2026-09-23.sql`). Migration D ends with an assertion over `pg_policies` that fails the apply if *any* admin read rule remains outside the allowlist, whatever its name (Task 5). Task 0 records the live list first.
3. **Old code still running during the rollout.** An old `moderate-content` still writing `content_snapshot` after migration D adds `CHECK (content_snapshot IS NULL)` would make every public share fail its queue insert. The insert is inside a try/catch, so shares still succeed, but no review would be queued. So the functions deploy (Task 9) comes strictly before migration D (Task 10), and Task 10 verifies the deployed versions first.
4. **Cached app shells after a column drop.** Menerio caches its app shell (`src/main.tsx`, offline-first). An old shell that still selects `profiles.avatar_url` gets a PostgREST 400 once the column is dropped, and its `AuthContext` profile load fails. The column drop waits at least 7 days after the new frontend ships (Task 11), and Task 11 checks for a week of zero `avatar_url` requests before dropping it.
5. **A logging failure must not hide an action or block the user.** Staff actions fail closed: if the log write fails, the action does not run (Tasks 1 and 4). Log rows can only hold ids and a fixed action word, never free text, so the log itself cannot become a new copy of content (Task 1 tests this). The owner's own requests never touch the log, so a log outage never blocks a normal user.

---

## File map

| File | Change | Responsibility |
|---|---|---|
| `supabase/migrations/20261001100000_staff_access_log.sql` | create | log table, `record_staff_access`, `my_staff_access_log`, admin-write trigger |
| `supabase/migrations/20261001100100_admin_directory_rpcs.sql` | create | `admin_user_directory`, `admin_user_names`, `admin_account_counts` |
| `supabase/migrations/20261001100200_moderation_snapshot_optional.sql` | create | `content_snapshot` nullable |
| `supabase/migrations/20261001100300_remove_admin_content_reads.sql` | create | drop admin read rules, wipe the moderation copies, apply-time assertion |
| `supabase/migrations/20261001100400_retire_avatars.sql` | create | drop the avatar storage rules, null the column, stop the signup trigger copying it |
| `supabase/migrations/20261008100000_privacy_cleanup_columns.sql` | create (≥7 days later) | drop `avatar_url`, `content_snapshot`, `flagged_content` |
| `scripts/test-staff-access-log.sql` | create | disposable-DB test for migration A |
| `scripts/test-admin-privacy.sql` | create | disposable-DB test for migrations B and D |
| `scripts/check-admin-read-policies.mjs` | create | static CI gate over all migrations |
| `scripts/oneoff/empty-avatars-bucket.mjs` | create | empty (and later delete) the `avatars` bucket through the Storage API |
| `.github/workflows/ci.yml` | modify | run the two SQL tests and the static gate |
| `package.json` | modify | `npm test` runs the static gate |
| `supabase/functions/_shared/staff-access.ts` (+ test) | create | `recordStaffAccess()` |
| `supabase/functions/_shared/moderation-source.ts` (+ test) | create | `loadSharedNoteForReview()`, `blockedModerationEvent()`, `reviewQueueItem()` |
| `supabase/functions/moderate-content/index.ts` | modify | no copies of text |
| `supabase/functions/ai-moderate-content/index.ts` | modify | read the note live, log, store no reason text |
| `supabase/functions/_shared/note-ai-processing.ts` (+ test) | modify | log admin re-analysis |
| `supabase/functions/process-note/index.ts` | modify | wire the log dependency |
| `supabase/functions/admin-delete-user/index.ts` | modify | log before deleting |
| `supabase/functions/ensure-token-allowance/index.ts` | modify | log an admin acting on another user's credits |
| `supabase/functions/_shared/delete-user-storage.ts` | modify | drop `avatars` from the bucket list |
| `src/lib/adminDirectory.ts` (+ test) | create | typed wrappers over the three admin RPCs |
| `src/pages/Admin.tsx` | modify | use the RPCs, no avatar, no bio |
| `src/components/admin/ModerationPanel.tsx` | modify | names through the RPC, no "AI Reason" column |
| `src/components/settings/StaffAccessCard.tsx` (+ test) | create | the user's view of the staff log |
| `src/pages/Settings.tsx` | modify | remove the Picture tab, add the Staff access card |
| `src/pages/Wizard.tsx` | modify | remove the photo upload |
| `src/contexts/AuthContext.tsx` | modify | stop selecting `avatar_url` |
| `src/lib/avatar-url.ts` | delete | |
| `src/pages/Privacy.tsx` | modify | "Who can see your data" section |
| `src/integrations/supabase/types.ts` | modify | new RPCs, and the dropped columns later |

---

### Task 0: Live baseline and go-live gate (read-only, no code)

**Files:** none changed. Output goes into the PR description of Task 9.

- [ ] **Step 1: Confirm the fact-store go-live is over**

Run:
```bash
git fetch origin main && git show origin/main:docs/plans/one-fact-store.md | sed -n 3p
bash scripts/rehearsal/prod-read.sh "select to_regclass('public.maintenance_flags') is not null as has_flags, (select is_on from public.maintenance_flags where key='fact_writes_paused') as paused"
```
Expected: the status line says the go-live is done (or rolled back), and `paused` is `false` or null. If `paused` is `true`, stop here: the go-live is still running.

- [ ] **Step 2: Confirm `scripts/rehearsal/prod-apply.sh` is on main**

Run: `git ls-tree origin/main --name-only scripts/rehearsal/`
Expected: `prod-apply.sh` is listed (it arrives with the fact-store merge). If it is missing, check it out from the fact-store branch in this task's commit: `git checkout origin/claude/wonderful-keller-sashcq -- scripts/rehearsal/prod-apply.sh`.

- [ ] **Step 3: Record every live admin read rule**

Run:
```bash
bash scripts/rehearsal/prod-read.sh "select schemaname, tablename, policyname, cmd from pg_policies where (coalesce(qual,'') ~* 'is_admin|''admin''' or coalesce(with_check,'') ~* 'is_admin|''admin''') order by 1,2,3"
```
Expected, at least (from the migrations): `note_chunks`, `media_analysis`, `profile_entries`, `profile_categories`, `profile_views`, `agent_instructions`, `profiles`, `activity_events`, `moderation_events`, `moderation_review_queue`, `llm_usage_events`, `llm_call_configs`, `moderation_stopwords` (two), `user_roles`, `ai_allowance_periods`, `user_suspensions`. Save the output. Any extra row that is on a user-content table must be added to migration D's drop list in Task 5.

- [ ] **Step 4: Record the counts the later tasks verify against**

Run:
```bash
bash scripts/rehearsal/prod-read.sh "select (select count(*) from storage.objects where bucket_id='avatars') as avatar_files, (select count(*) from public.profiles where avatar_url is not null) as profiles_with_avatar, (select count(*) from public.moderation_review_queue where content_snapshot is not null) as queue_copies, (select count(*) from public.moderation_events where flagged_content is not null) as event_copies"
npx supabase@latest functions list --project-ref tjeapelvjlmbxafsmjef | grep -E "admin-normalize|moderate-content|process-note|admin-delete-user"
```
Save the numbers. If `admin-normalize` is still deployed (the go-live was rolled back), Task 4 Step 6 applies.

---

### Task 1: Staff access log (database + edge helper)

**Files:**
- Create: `supabase/migrations/20261001100000_staff_access_log.sql`
- Create: `scripts/test-staff-access-log.sql`
- Create: `supabase/functions/_shared/staff-access.ts`
- Test: `supabase/functions/_shared/__tests__/staff-access.test.ts`
- Modify: `.github/workflows/ci.yml` (the `database-permissions` job)

**Interfaces:**
- Produces (SQL): `public.record_staff_access(p_subject uuid, p_actor uuid, p_actor_kind text, p_action text, p_note_id uuid DEFAULT NULL) RETURNS uuid`, service role only.
- Produces (SQL): `public.my_staff_access_log() RETURNS TABLE(action text, actor_kind text, note_id uuid, created_at timestamptz)`, authenticated, own rows only, newest first, at most 200.
- Produces (TS): `recordStaffAccess(db: RpcLike, e: StaffAccessEntry): Promise<void>`, which throws on failure; `type StaffActorKind = "admin" | "system" | "shared_key"`; `interface StaffAccessEntry { subjectUserId: string; actorUserId: string | null; actorKind: StaffActorKind; action: string; noteId?: string | null }`.

- [ ] **Step 1: Write the failing SQL test**

Create `scripts/test-staff-access-log.sql`:
```sql
\set ON_ERROR_STOP on
-- Only a fresh disposable database; never run against an application database.
DO $$ BEGIN
 IF current_database() <> 'staff_access_log_test' THEN RAISE EXCEPTION 'staff_access_log_test only'; END IF;
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
GRANT USAGE ON SCHEMA auth TO authenticated, service_role;
CREATE TYPE public.app_role AS ENUM ('free','premium','premium_gift','admin');
CREATE TABLE public.user_roles(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, role public.app_role NOT NULL);
CREATE FUNCTION public.is_admin(_user_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS
 $$SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=_user_id AND role='admin')$$;
CREATE TABLE public.ai_allowance_periods(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, tokens int DEFAULT 0);
CREATE TABLE public.user_suspensions(user_id uuid PRIMARY KEY, suspended boolean DEFAULT false);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_allowance_periods ENABLE ROW LEVEL SECURITY;
CREATE POLICY admin_all ON public.user_roles FOR ALL TO authenticated USING (public.is_admin(auth.uid()));
CREATE POLICY admin_all ON public.ai_allowance_periods FOR ALL TO authenticated USING (public.is_admin(auth.uid()));
GRANT SELECT,INSERT,UPDATE,DELETE ON public.user_roles, public.ai_allowance_periods TO authenticated;
INSERT INTO public.user_roles(user_id,role) VALUES
 ('a0000000-0000-0000-0000-000000000001','admin'),
 ('b0000000-0000-0000-0000-000000000002','free');
\ir ../supabase/migrations/20261001100000_staff_access_log.sql

-- 1. The service role records; ids only.
SET ROLE service_role;
SELECT public.record_staff_access('b0000000-0000-0000-0000-000000000002', NULL, 'system', 'moderation_review', 'c0000000-0000-0000-0000-000000000003');
DO $$BEGIN
 BEGIN PERFORM public.record_staff_access('b0000000-0000-0000-0000-000000000002', NULL, 'system', 'Read the note: secret text'); RAISE EXCEPTION 'free text accepted as action';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN PERFORM public.record_staff_access('b0000000-0000-0000-0000-000000000002', NULL, 'janitor', 'moderation_review'); RAISE EXCEPTION 'unknown actor kind accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
RESET ROLE;

-- 2. A browser user can neither write the log nor read the table.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','b0000000-0000-0000-0000-000000000002',false);
DO $$BEGIN
 BEGIN PERFORM public.record_staff_access('b0000000-0000-0000-0000-000000000002', NULL, 'system', 'fake_entry'); RAISE EXCEPTION 'browser wrote the log';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM * FROM private.staff_access_log; RAISE EXCEPTION 'log table exposed';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 IF (SELECT count(*) FROM public.my_staff_access_log()) <> 1 THEN RAISE EXCEPTION 'owner does not see own entry'; END IF;
END $$;
RESET ROLE;

-- 3. An admin writing another user's billing row is logged by the trigger; writing their own is not.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','a0000000-0000-0000-0000-000000000001',false);
INSERT INTO public.ai_allowance_periods(user_id,tokens) VALUES ('b0000000-0000-0000-0000-000000000002', 100);
INSERT INTO public.ai_allowance_periods(user_id,tokens) VALUES ('a0000000-0000-0000-0000-000000000001', 100);
UPDATE public.user_roles SET role='premium' WHERE user_id='b0000000-0000-0000-0000-000000000002';
DO $$BEGIN
 IF (SELECT count(*) FROM public.my_staff_access_log()) <> 0 THEN RAISE EXCEPTION 'admin sees entries that are not about them'; END IF;
END $$;
RESET ROLE;
DO $$BEGIN
 IF (SELECT count(*) FROM private.staff_access_log WHERE subject_user_id='b0000000-0000-0000-0000-000000000002' AND actor_kind='admin') <> 2 THEN RAISE EXCEPTION 'admin writes not logged'; END IF;
 IF (SELECT count(*) FROM private.staff_access_log WHERE subject_user_id='a0000000-0000-0000-0000-000000000001') <> 0 THEN RAISE EXCEPTION 'own write logged'; END IF;
END $$;

-- 4. Append-only, even for the table owner's roles.
DO $$BEGIN
 BEGIN UPDATE private.staff_access_log SET action='edited'; RAISE EXCEPTION 'log editable';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'staff_access_log is append-only' THEN RAISE; END IF; END;
 BEGIN DELETE FROM private.staff_access_log; RAISE EXCEPTION 'log deletable';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'staff_access_log is append-only' THEN RAISE; END IF; END;
END $$;
\echo 'staff access log: all assertions passed'
```

- [ ] **Step 2: Run it and watch it fail**

Run: `createdb staff_access_log_test && psql -v ON_ERROR_STOP=1 -d staff_access_log_test -f scripts/test-staff-access-log.sql`
Expected: FAIL at `\ir`, because the migration file does not exist. Drop the database after each run: `dropdb staff_access_log_test`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20261001100000_staff_access_log.sql`:
```sql
-- Every staff or system action on someone else's account, so a user can see it.
-- Ids and a fixed action word only: the log must never become a copy of content.
CREATE SCHEMA IF NOT EXISTS private;

CREATE TABLE private.staff_access_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_user_id uuid NOT NULL,
  actor_user_id uuid,
  actor_kind text NOT NULL CHECK (actor_kind IN ('admin','system','shared_key')),
  action text NOT NULL CHECK (action ~ '^[a-z_]{3,40}$'),
  note_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX staff_access_log_subject_idx ON private.staff_access_log (subject_user_id, created_at DESC);
REVOKE ALL ON private.staff_access_log FROM PUBLIC, anon, authenticated;

CREATE FUNCTION private.staff_access_log_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'staff_access_log is append-only';
END $$;
CREATE TRIGGER staff_access_log_append_only
  BEFORE UPDATE OR DELETE ON private.staff_access_log
  FOR EACH ROW EXECUTE FUNCTION private.staff_access_log_append_only();

CREATE FUNCTION public.record_staff_access(
  p_subject uuid, p_actor uuid, p_actor_kind text, p_action text, p_note_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE sql SECURITY DEFINER SET search_path = private, public AS $$
  INSERT INTO private.staff_access_log (subject_user_id, actor_user_id, actor_kind, action, note_id)
  VALUES (p_subject, p_actor, p_actor_kind, p_action, p_note_id)
  RETURNING id;
$$;
REVOKE ALL ON FUNCTION public.record_staff_access(uuid,uuid,text,text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_staff_access(uuid,uuid,text,text,uuid) TO service_role;

CREATE FUNCTION public.my_staff_access_log()
RETURNS TABLE (action text, actor_kind text, note_id uuid, created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = private, public AS $$
  SELECT l.action, l.actor_kind, l.note_id, l.created_at
  FROM private.staff_access_log l
  WHERE l.subject_user_id = auth.uid()
  ORDER BY l.created_at DESC
  LIMIT 200;
$$;
REVOKE ALL ON FUNCTION public.my_staff_access_log() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_staff_access_log() TO authenticated;

-- Admin writes made straight from the Admin page (roles, credits, suspensions).
CREATE FUNCTION private.log_admin_write() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = private, public AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_subject uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN v_subject := OLD.user_id; ELSE v_subject := NEW.user_id; END IF;
  IF v_actor IS NOT NULL AND v_subject IS DISTINCT FROM v_actor AND public.is_admin(v_actor) THEN
    INSERT INTO private.staff_access_log (subject_user_id, actor_user_id, actor_kind, action)
    VALUES (v_subject, v_actor, 'admin', lower(TG_TABLE_NAME || '_' || TG_OP));
  END IF;
  RETURN NULL;
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['user_roles','ai_allowance_periods','user_suspensions'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS log_admin_write ON public.%I', t);
      EXECUTE format('CREATE TRIGGER log_admin_write AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION private.log_admin_write()', t);
    END IF;
  END LOOP;
END $$;
```

- [ ] **Step 4: Run the SQL test and watch it pass**

Run: `dropdb --if-exists staff_access_log_test && createdb staff_access_log_test && psql -v ON_ERROR_STOP=1 -d staff_access_log_test -f scripts/test-staff-access-log.sql`
Expected: `staff access log: all assertions passed`.

- [ ] **Step 5: Write the failing helper test**

Create `supabase/functions/_shared/__tests__/staff-access.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { recordStaffAccess } from "../staff-access.ts";

function fakeDb(error: { message: string } | null = null) {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  return {
    calls,
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      return { error };
    },
  };
}

describe("recordStaffAccess", () => {
  it("sends ids and the action word to record_staff_access", async () => {
    const db = fakeDb();
    await recordStaffAccess(db, { subjectUserId: "u1", actorUserId: "a1", actorKind: "admin", action: "reanalyze_note", noteId: "n1" });
    expect(db.calls).toEqual([{ fn: "record_staff_access", args: { p_subject: "u1", p_actor: "a1", p_actor_kind: "admin", p_action: "reanalyze_note", p_note_id: "n1" } }]);
  });

  it("sends a null note id when none is given", async () => {
    const db = fakeDb();
    await recordStaffAccess(db, { subjectUserId: "u1", actorUserId: null, actorKind: "system", action: "delete_account" });
    expect(db.calls[0].args.p_note_id).toBeNull();
  });

  it("throws when the database refuses, so the caller does not act", async () => {
    const db = fakeDb({ message: "boom" });
    await expect(recordStaffAccess(db, { subjectUserId: "u1", actorUserId: "a1", actorKind: "admin", action: "reanalyze_note" })).rejects.toThrow("staff access not recorded: boom");
  });

  it("refuses an action that is not a plain word, before calling the database", async () => {
    const db = fakeDb();
    await expect(recordStaffAccess(db, { subjectUserId: "u1", actorUserId: "a1", actorKind: "admin", action: "read: secret" })).rejects.toThrow("invalid staff action");
    expect(db.calls).toEqual([]);
  });
});
```

- [ ] **Step 6: Run it and watch it fail**

Run: `npx vitest run supabase/functions/_shared/__tests__/staff-access.test.ts`
Expected: FAIL, "Failed to resolve import ../staff-access.ts".

- [ ] **Step 7: Write the helper**

Create `supabase/functions/_shared/staff-access.ts`:
```ts
/**
 * Record a staff or system action on someone else's account.
 *
 * Fail closed: this throws when the row cannot be written, and every caller
 * records BEFORE it acts, so an action that is not in the user's log did not
 * happen. Only ids and a fixed action word go in; the log must never become a
 * copy of anyone's content (see private.staff_access_log).
 */
export type StaffActorKind = "admin" | "system" | "shared_key";

export interface StaffAccessEntry {
  subjectUserId: string;
  actorUserId: string | null;
  actorKind: StaffActorKind;
  action: string;
  noteId?: string | null;
}

interface RpcLike {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ error: { message: string } | null }>;
}

export async function recordStaffAccess(db: RpcLike, e: StaffAccessEntry): Promise<void> {
  if (!/^[a-z_]{3,40}$/.test(e.action)) throw new Error(`invalid staff action: ${e.action}`);
  const { error } = await db.rpc("record_staff_access", {
    p_subject: e.subjectUserId,
    p_actor: e.actorUserId,
    p_actor_kind: e.actorKind,
    p_action: e.action,
    p_note_id: e.noteId ?? null,
  });
  if (error) throw new Error(`staff access not recorded: ${error.message}`);
}
```

- [ ] **Step 8: Run it and watch it pass**

Run: `npx vitest run supabase/functions/_shared/__tests__/staff-access.test.ts`
Expected: 4 passed.

- [ ] **Step 9: Add the SQL test to CI**

In `.github/workflows/ci.yml`, job `database-permissions`, step "Test sync permissions, …", append to the `run:` block:
```yaml
          createdb staff_access_log_test
          psql -v ON_ERROR_STOP=1 -d staff_access_log_test -f scripts/test-staff-access-log.sql
```

- [ ] **Step 10: Commit**

```bash
git add supabase/migrations/20261001100000_staff_access_log.sql scripts/test-staff-access-log.sql supabase/functions/_shared/staff-access.ts supabase/functions/_shared/__tests__/staff-access.test.ts .github/workflows/ci.yml
git commit -m "Staff access log: append-only record of staff actions on another account"
```

---

### Task 2: Admin directory functions and the Admin page on them

**Files:**
- Create: `supabase/migrations/20261001100100_admin_directory_rpcs.sql`
- Create: `scripts/test-admin-privacy.sql` (the directory part now; Task 5 extends it)
- Create: `src/lib/adminDirectory.ts`
- Test: `src/lib/__tests__/adminDirectory.test.ts`
- Modify: `src/pages/Admin.tsx:172-189` (counts), `:268-315` (user list), `:766-816` (usage names), `:81-89` (`UserRow`), `:453` (avatar cell)
- Modify: `src/components/admin/ModerationPanel.tsx:44-51` (`fetchProfileNames`)
- Modify: `src/integrations/supabase/types.ts` (`Functions`)
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Produces (SQL): `public.admin_user_directory(p_search text DEFAULT NULL, p_role public.app_role DEFAULT NULL, p_limit int DEFAULT 25, p_offset int DEFAULT 0) RETURNS TABLE(id uuid, display_name text, created_at timestamptz, role public.app_role, total_count bigint)`; `public.admin_user_names(p_ids uuid[]) RETURNS TABLE(id uuid, display_name text)`; `public.admin_account_counts() RETURNS TABLE(total_users bigint, new_users_7d bigint, paid_users bigint)`. All raise `42501` for a non-admin.
- Produces (TS, `src/lib/adminDirectory.ts`): `fetchUserDirectory(o: { search?: string; role?: AppRole | null; page: number; pageSize: number }): Promise<{ rows: DirectoryRow[]; total: number }>`, `fetchUserNames(ids: string[]): Promise<Record<string, string>>`, `fetchAccountCounts(): Promise<{ totalUsers: number; newUsers7d: number; paidUsers: number }>`, `interface DirectoryRow { id: string; display_name: string | null; created_at: string; role: AppRole | null }`.

- [ ] **Step 1: Write the failing SQL test (directory part)**

Create `scripts/test-admin-privacy.sql`:
```sql
\set ON_ERROR_STOP on
-- Only a fresh disposable database; never run against an application database.
DO $$ BEGIN
 IF current_database() <> 'admin_privacy_test' THEN RAISE EXCEPTION 'admin_privacy_test only'; END IF;
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
GRANT USAGE ON SCHEMA auth TO authenticated;
CREATE TYPE public.app_role AS ENUM ('free','premium','premium_gift','admin');
CREATE TABLE public.user_roles(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, role public.app_role NOT NULL);
CREATE FUNCTION public.is_admin(_user_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS
 $$SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=_user_id AND role='admin')$$;
CREATE TABLE public.profiles(id uuid PRIMARY KEY, display_name text, avatar_url text, bio text, created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own profile" ON public.profiles FOR SELECT TO authenticated USING (id = auth.uid());
CREATE POLICY "Admins can view all profiles" ON public.profiles FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));
GRANT SELECT ON public.profiles, public.user_roles TO authenticated;
INSERT INTO public.user_roles(user_id,role) VALUES
 ('a0000000-0000-0000-0000-000000000001','admin'),
 ('b0000000-0000-0000-0000-000000000002','free'),
 ('c0000000-0000-0000-0000-000000000003','premium');
INSERT INTO public.profiles(id,display_name,bio,created_at) VALUES
 ('a0000000-0000-0000-0000-000000000001','Admin','admin bio', now() - interval '30 days'),
 ('b0000000-0000-0000-0000-000000000002','Bea','private bio', now() - interval '2 days'),
 ('c0000000-0000-0000-0000-000000000003','Cem 100%_sure','other bio', now() - interval '20 days');
\ir ../supabase/migrations/20261001100100_admin_directory_rpcs.sql

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','a0000000-0000-0000-0000-000000000001',false);
DO $$BEGIN
 IF (SELECT count(*) FROM public.admin_user_directory()) <> 3 THEN RAISE EXCEPTION 'directory incomplete'; END IF;
 IF (SELECT total_count FROM public.admin_user_directory(NULL, NULL, 1, 0)) <> 3 THEN RAISE EXCEPTION 'total_count wrong'; END IF;
 IF (SELECT count(*) FROM public.admin_user_directory('bea')) <> 1 THEN RAISE EXCEPTION 'search broken'; END IF;
 -- Only Cem's name contains a literal %; an unescaped pattern would match all three.
 IF (SELECT count(*) FROM public.admin_user_directory('%')) <> 1 THEN RAISE EXCEPTION 'search treats %% as a wildcard'; END IF;
 IF (SELECT count(*) FROM public.admin_user_directory('_')) <> 1 THEN RAISE EXCEPTION 'search treats _ as a wildcard'; END IF;
 IF (SELECT count(*) FROM public.admin_user_directory(NULL, 'premium')) <> 1 THEN RAISE EXCEPTION 'role filter broken'; END IF;
 IF (SELECT count(*) FROM public.admin_user_directory(NULL, NULL, 1000, 0)) <> 3 THEN RAISE EXCEPTION 'limit not clamped sanely'; END IF;
 IF (SELECT new_users_7d FROM public.admin_account_counts()) <> 1 THEN RAISE EXCEPTION 'week count wrong'; END IF;
 IF (SELECT paid_users FROM public.admin_account_counts()) <> 2 THEN RAISE EXCEPTION 'paid count wrong'; END IF;
 IF (SELECT display_name FROM public.admin_user_names(ARRAY['b0000000-0000-0000-0000-000000000002']::uuid[])) <> 'Bea' THEN RAISE EXCEPTION 'names broken'; END IF;
END $$;
-- The directory's columns are exactly these; no bio, no avatar.
DO $$BEGIN
 IF (SELECT string_agg(parameter_name, ',' ORDER BY ordinal_position) FROM information_schema.parameters
     WHERE specific_name LIKE 'admin_user_directory%' AND parameter_mode='OUT') <> 'id,display_name,created_at,role,total_count'
 THEN RAISE EXCEPTION 'directory columns changed'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','b0000000-0000-0000-0000-000000000002',false);
DO $$BEGIN
 BEGIN PERFORM public.admin_user_directory(); RAISE EXCEPTION 'non-admin read the directory'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.admin_user_names(ARRAY['a0000000-0000-0000-0000-000000000001']::uuid[]); RAISE EXCEPTION 'non-admin read names'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.admin_account_counts(); RAISE EXCEPTION 'non-admin read counts'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SET ROLE anon;
DO $$BEGIN
 BEGIN PERFORM public.admin_account_counts(); RAISE EXCEPTION 'anon read counts'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
\echo 'admin directory: all assertions passed'
```

- [ ] **Step 2: Run it and watch it fail**

Run: `dropdb --if-exists admin_privacy_test; createdb admin_privacy_test && psql -v ON_ERROR_STOP=1 -d admin_privacy_test -f scripts/test-admin-privacy.sql`
Expected: FAIL at `\ir` (file missing).

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20261001100100_admin_directory_rpcs.sql`:
```sql
-- What the Admin page may know about accounts: name, sign-up date, role, counts.
-- Nothing a user wrote (bio, notes, facts). Replaces the admin read rule on
-- profiles, which migration 20261001100300 drops.
CREATE OR REPLACE FUNCTION public.admin_user_directory(
  p_search text DEFAULT NULL, p_role public.app_role DEFAULT NULL,
  p_limit int DEFAULT 25, p_offset int DEFAULT 0
) RETURNS TABLE (id uuid, display_name text, created_at timestamptz, role public.app_role, total_count bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_pattern text;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin only' USING ERRCODE = '42501';
  END IF;
  IF p_search IS NOT NULL AND btrim(p_search) <> '' THEN
    v_pattern := '%' || replace(replace(replace(btrim(p_search), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  END IF;
  RETURN QUERY
  SELECT p.id, p.display_name, p.created_at, r.role, count(*) OVER ()
  FROM public.profiles p
  LEFT JOIN public.user_roles r ON r.user_id = p.id
  WHERE (v_pattern IS NULL OR p.display_name ILIKE v_pattern)
    AND (p_role IS NULL OR r.role = p_role)
  ORDER BY p.created_at DESC
  LIMIT least(greatest(coalesce(p_limit, 25), 1), 100)
  OFFSET greatest(coalesce(p_offset, 0), 0);
END $$;

CREATE OR REPLACE FUNCTION public.admin_user_names(p_ids uuid[])
RETURNS TABLE (id uuid, display_name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin only' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT p.id, p.display_name FROM public.profiles p WHERE p.id = ANY (p_ids[1:500]);
END $$;

CREATE OR REPLACE FUNCTION public.admin_account_counts()
RETURNS TABLE (total_users bigint, new_users_7d bigint, paid_users bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin only' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT
    (SELECT count(*) FROM public.profiles),
    (SELECT count(*) FROM public.profiles WHERE created_at >= now() - interval '7 days'),
    (SELECT count(*) FROM public.user_roles WHERE role IN ('premium','premium_gift','admin'));
END $$;

REVOKE ALL ON FUNCTION public.admin_user_directory(text, public.app_role, int, int) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_user_names(uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_account_counts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_user_directory(text, public.app_role, int, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_user_names(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_account_counts() TO authenticated;
```
Note: `paid_users` counts `admin` too, exactly like the current "Premium users" card (`Admin.tsx:176`).

- [ ] **Step 4: Run the SQL test and watch it pass**

Run: `dropdb --if-exists admin_privacy_test; createdb admin_privacy_test && psql -v ON_ERROR_STOP=1 -d admin_privacy_test -f scripts/test-admin-privacy.sql`
Expected: `admin directory: all assertions passed`.

- [ ] **Step 5: Write the failing wrapper test**

Create `src/lib/__tests__/adminDirectory.test.ts`:
```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));

import { fetchAccountCounts, fetchUserDirectory, fetchUserNames } from "@/lib/adminDirectory";

beforeEach(() => rpc.mockReset());

describe("fetchUserDirectory", () => {
  it("passes paging and filters and splits the total off the rows", async () => {
    rpc.mockResolvedValue({ data: [{ id: "u1", display_name: "Bea", created_at: "2026-09-01", role: "free", total_count: 42 }], error: null });
    const res = await fetchUserDirectory({ search: "  bea ", role: "free", page: 2, pageSize: 10 });
    expect(rpc).toHaveBeenCalledWith("admin_user_directory", { p_search: "bea", p_role: "free", p_limit: 10, p_offset: 20 });
    expect(res).toEqual({ rows: [{ id: "u1", display_name: "Bea", created_at: "2026-09-01", role: "free" }], total: 42 });
  });

  it("sends nulls for an empty search and no role", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    const res = await fetchUserDirectory({ search: "  ", role: null, page: 0, pageSize: 10 });
    expect(rpc).toHaveBeenCalledWith("admin_user_directory", { p_search: null, p_role: null, p_limit: 10, p_offset: 0 });
    expect(res).toEqual({ rows: [], total: 0 });
  });

  it("throws the database error", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "admin only" } });
    await expect(fetchUserDirectory({ page: 0, pageSize: 10 })).rejects.toThrow("admin only");
  });
});

describe("fetchUserNames", () => {
  it("returns an empty map without calling the database for no ids", async () => {
    expect(await fetchUserNames([])).toEqual({});
    expect(rpc).not.toHaveBeenCalled();
  });

  it("de-duplicates ids and falls back to a short id for a missing name", async () => {
    rpc.mockResolvedValue({ data: [{ id: "abcdef123456", display_name: null }], error: null });
    expect(await fetchUserNames(["abcdef123456", "abcdef123456"])).toEqual({ abcdef123456: "abcdef12" });
    expect(rpc).toHaveBeenCalledWith("admin_user_names", { p_ids: ["abcdef123456"] });
  });
});

describe("fetchAccountCounts", () => {
  it("maps the row to numbers", async () => {
    rpc.mockResolvedValue({ data: [{ total_users: "12", new_users_7d: 3, paid_users: 2 }], error: null });
    expect(await fetchAccountCounts()).toEqual({ totalUsers: 12, newUsers7d: 3, paidUsers: 2 });
  });
});
```

- [ ] **Step 6: Run it and watch it fail**

Run: `npx vitest run src/lib/__tests__/adminDirectory.test.ts`
Expected: FAIL, cannot resolve `@/lib/adminDirectory`.

- [ ] **Step 7: Write the wrapper**

Create `src/lib/adminDirectory.ts`:
```ts
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

type AppRole = Database["public"]["Enums"]["app_role"];

/** What the Admin page may know about an account. Nothing the user wrote. */
export interface DirectoryRow {
  id: string;
  display_name: string | null;
  created_at: string;
  role: AppRole | null;
}

export async function fetchUserDirectory(o: {
  search?: string;
  role?: AppRole | null;
  page: number;
  pageSize: number;
}): Promise<{ rows: DirectoryRow[]; total: number }> {
  const { data, error } = await supabase.rpc("admin_user_directory", {
    p_search: o.search?.trim() || null,
    p_role: o.role ?? null,
    p_limit: o.pageSize,
    p_offset: o.page * o.pageSize,
  });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Array<DirectoryRow & { total_count: number }>;
  return {
    rows: rows.map(({ total_count: _total, ...row }) => row),
    total: rows.length ? Number(rows[0].total_count) : 0,
  };
}

export async function fetchUserNames(ids: string[]): Promise<Record<string, string>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return {};
  const { data, error } = await supabase.rpc("admin_user_names", { p_ids: unique });
  if (error) throw new Error(error.message);
  const map: Record<string, string> = {};
  for (const p of (data ?? []) as Array<{ id: string; display_name: string | null }>) {
    map[p.id] = p.display_name || p.id.slice(0, 8);
  }
  return map;
}

export async function fetchAccountCounts(): Promise<{ totalUsers: number; newUsers7d: number; paidUsers: number }> {
  const { data, error } = await supabase.rpc("admin_account_counts");
  if (error) throw new Error(error.message);
  const row = ((data ?? []) as Array<{ total_users: number | string; new_users_7d: number | string; paid_users: number | string }>)[0];
  return {
    totalUsers: Number(row?.total_users ?? 0),
    newUsers7d: Number(row?.new_users_7d ?? 0),
    paidUsers: Number(row?.paid_users ?? 0),
  };
}
```

- [ ] **Step 8: Add the three functions to the generated types**

In `src/integrations/supabase/types.ts`, inside `public: { … Functions: {` (around line 4897), add in alphabetical position:
```ts
      admin_account_counts: {
        Args: Record<PropertyKey, never>
        Returns: { new_users_7d: number; paid_users: number; total_users: number }[]
      }
      admin_user_directory: {
        Args: { p_limit?: number; p_offset?: number; p_role?: Database["public"]["Enums"]["app_role"] | null; p_search?: string | null }
        Returns: { created_at: string; display_name: string | null; id: string; role: Database["public"]["Enums"]["app_role"] | null; total_count: number }[]
      }
      admin_user_names: {
        Args: { p_ids: string[] }
        Returns: { display_name: string | null; id: string }[]
      }
```

- [ ] **Step 9: Run the wrapper test and watch it pass**

Run: `npx vitest run src/lib/__tests__/adminDirectory.test.ts`
Expected: 6 passed.

- [ ] **Step 10: Move the Admin page onto the wrapper**

In `src/pages/Admin.tsx`:

1. Add `import { fetchAccountCounts, fetchUserDirectory, fetchUserNames, type DirectoryRow } from "@/lib/adminDirectory";`.
2. Replace the `Promise.all([...])` block in the overview effect (lines 174-189) with:
```tsx
      const [counts, tokensRes] = await Promise.all([
        fetchAccountCounts(),
        // Ask the database for the sum. Fetching every `total_tokens` row and
        // adding it up here read low by 23x: PostgREST caps a response at
        // max_rows (1000 on this project) and the ledger holds 20,297 rows.
        supabase.from("llm_usage_totals" as any).select("total_tokens").maybeSingle(),
      ]);

      const totalTokens = Number((tokensRes.data as any)?.total_tokens ?? 0);

      setStats({
        totalUsers: counts.totalUsers,
        premiumUsers: counts.paidUsers,
        newThisWeek: counts.newUsers7d,
        totalTokensUsed: totalTokens,
      });
```
3. Replace `interface UserRow { … }` (lines 81-89) with `type UserRow = DirectoryRow;`.
4. Replace the body of `fetchUsers` (lines 268-315) with:
```tsx
  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const { rows, total } = await fetchUserDirectory({
        search,
        role: roleFilter === "all" ? null : (roleFilter as AppRole),
        page,
        pageSize: PAGE_SIZE,
      });
      const roleMap: Record<string, AppRole> = {};
      rows.forEach((r) => { if (r.role) roleMap[r.id] = r.role; });
      setRoles(roleMap);
      setUsers(rows);
      setTotal(total);
    } catch {
      setUsers([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [search, roleFilter, page]);
```
5. At line 453, delete `{u.avatar_url && <AvatarImage src={avatarPublicUrl(u.avatar_url)} />}` and keep the `AvatarFallback`. Remove any cell or text that shows `u.bio`. Remove the `avatarPublicUrl` import (line 3) and `AvatarImage` from the avatar import if nothing else uses it.
6. In the usage panel (lines 766-816), replace the display-name search with:
```tsx
    if (userSearch.trim()) {
      const { rows } = await fetchUserDirectory({ search: userSearch, page: 0, pageSize: 100 });
      matchedUserIds = rows.map((r) => r.id);
      if (matchedUserIds.length === 0) {
        setEvents([]);
        setTotal(0);
        setLoading(false);
        return;
      }
    }
```
and replace the name lookup for the page's user ids with:
```tsx
    const userIds = [...new Set(rows.map((r) => r.user_id))];
    if (userIds.length > 0) {
      const map = await fetchUserNames(userIds).catch(() => ({} as Record<string, string>));
      setProfiles((prev) => ({ ...prev, ...map }));
    }
```

- [ ] **Step 11: Move the moderation panel's names onto the wrapper**

In `src/components/admin/ModerationPanel.tsx`, replace `fetchProfileNames` (lines 44-51) with:
```tsx
async function fetchProfileNames(userIds: string[]): Promise<ProfileMap> {
  return fetchUserNames(userIds).catch(() => ({}));
}
```
and add `import { fetchUserNames } from "@/lib/adminDirectory";`.

- [ ] **Step 12: Type check, run all tests, build**

Run: `npx tsc --noEmit -p tsconfig.app.json && npm test && npm run build`
Expected: no errors, all tests pass. The existing `AdminRoute.test.tsx` must still pass unchanged.

- [ ] **Step 13: Add the SQL test to CI**

Append to the same `run:` block in `.github/workflows/ci.yml`:
```yaml
          createdb admin_privacy_test
          psql -v ON_ERROR_STOP=1 -d admin_privacy_test -f scripts/test-admin-privacy.sql
```

- [ ] **Step 14: Commit**

```bash
git add supabase/migrations/20261001100100_admin_directory_rpcs.sql scripts/test-admin-privacy.sql src/lib/adminDirectory.ts src/lib/__tests__/adminDirectory.test.ts src/pages/Admin.tsx src/components/admin/ModerationPanel.tsx src/integrations/supabase/types.ts .github/workflows/ci.yml
git commit -m "Admin page reads accounts through admin-only functions that return no user content"
```

---

### Task 3: Moderation without copies of note text

**Files:**
- Create: `supabase/migrations/20261001100200_moderation_snapshot_optional.sql`
- Create: `supabase/functions/_shared/moderation-source.ts`
- Test: `supabase/functions/_shared/__tests__/moderation-source.test.ts`
- Modify: `supabase/functions/moderate-content/index.ts:147-203`
- Modify: `supabase/functions/ai-moderate-content/index.ts:94-170` and `extractTitle` (line 258)
- Modify: `src/components/admin/ModerationPanel.tsx:234-258` (drop the "AI Reason" column)

**Interfaces:**
- Consumes: `recordStaffAccess` from Task 1.
- Produces: `loadSharedNoteForReview(db: NoteReaderLike, noteId: string | null, userId: string): Promise<{ title: string; text: string } | null>`; `blockedModerationEvent(a: { userId: string; action: string; itemType: string; itemId: string | null; matched: string[]; category: string; tier: "stopword" | "ai" }): Record<string, unknown>`; `reviewQueueItem(a: { userId: string; itemType: string; itemId: string }): Record<string, unknown>`.

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/_shared/__tests__/moderation-source.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { blockedModerationEvent, loadSharedNoteForReview, reviewQueueItem } from "../moderation-source.ts";

type Row = Record<string, unknown>;
function fakeDb(tables: Record<string, Row[]>) {
  return {
    from(table: string) {
      const filters: Array<[string, unknown]> = [];
      const q = {
        select: () => q,
        eq: (col: string, val: unknown) => { filters.push([col, val]); return q; },
        maybeSingle: async () => ({
          data: (tables[table] ?? []).find((r) => filters.every(([c, v]) => r[c] === v)) ?? null,
          error: null,
        }),
      };
      return q;
    },
  };
}

const db = fakeDb({
  shared_notes: [
    { note_id: "n1", user_id: "u1", is_active: true },
    { note_id: "n2", user_id: "u1", is_active: false },
  ],
  notes: [
    { id: "n1", user_id: "u1", title: "Trip", content: "<p>Hello <b>world</b></p>" },
    { id: "n2", user_id: "u1", title: "Old", content: "gone" },
    { id: "n3", user_id: "u2", title: "Other", content: "x" },
  ],
});

describe("loadSharedNoteForReview", () => {
  it("returns the plain text of a note that is still publicly shared by its owner", async () => {
    expect(await loadSharedNoteForReview(db, "n1", "u1")).toEqual({ title: "Trip", text: "Trip Hello world" });
  });
  it("returns null once the share was turned off", async () => {
    expect(await loadSharedNoteForReview(db, "n2", "u1")).toBeNull();
  });
  it("returns null for a note that was never shared or belongs to someone else", async () => {
    expect(await loadSharedNoteForReview(db, "n3", "u1")).toBeNull();
  });
  it("returns null without a note id", async () => {
    expect(await loadSharedNoteForReview(db, null, "u1")).toBeNull();
  });
});

describe("record builders never carry text", () => {
  it("a blocked event keeps matched words and category, and no content field", () => {
    const e = blockedModerationEvent({ userId: "u1", action: "share_note", itemType: "note", itemId: "n1", matched: ["badword", "[PII:email]"], category: "abuse", tier: "stopword" });
    expect(e).toEqual({ user_id: "u1", action: "share_note", item_type: "note", item_id: "n1", matched_words: ["badword", "[PII:email]"], category: "abuse", result: "blocked", tier: "stopword" });
    expect(Object.keys(e)).not.toContain("flagged_content");
  });
  it("a queue item is a reference only", () => {
    expect(reviewQueueItem({ userId: "u1", itemType: "note", itemId: "n1" })).toEqual({ user_id: "u1", item_type: "note", item_id: "n1", status: "pending" });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run supabase/functions/_shared/__tests__/moderation-source.test.ts`
Expected: FAIL, cannot resolve `../moderation-source.ts`.

- [ ] **Step 3: Write the module**

Create `supabase/functions/_shared/moderation-source.ts`:
```ts
/**
 * Moderation keeps references, never copies of text.
 *
 * Only a note someone chose to share publicly is ever checked, and the AI
 * review reads it live, at review time, and only while the share is still on.
 * Nothing here stores the text: the admin tables hold ids, matched words and a
 * category, so an admin can never read a note through moderation.
 */
interface Query {
  select(cols: string): Query;
  eq(col: string, val: unknown): Query;
  maybeSingle(): PromiseLike<{ data: Record<string, unknown> | null; error: unknown }>;
}
export interface NoteReaderLike {
  from(table: string): Query;
}

const stripHtml = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

export async function loadSharedNoteForReview(
  db: NoteReaderLike,
  noteId: string | null,
  userId: string,
): Promise<{ title: string; text: string } | null> {
  if (!noteId) return null;
  const { data: share } = await db.from("shared_notes").select("note_id")
    .eq("note_id", noteId).eq("user_id", userId).eq("is_active", true).maybeSingle();
  if (!share) return null;
  const { data: note } = await db.from("notes").select("title, content")
    .eq("id", noteId).eq("user_id", userId).maybeSingle();
  if (!note) return null;
  const title = String(note.title ?? "").trim() || "Untitled Note";
  const text = stripHtml(`${note.title ?? ""} ${note.content ?? ""}`).slice(0, 5000);
  return { title: title.slice(0, 100), text };
}

export function blockedModerationEvent(a: {
  userId: string; action: string; itemType: string; itemId: string | null;
  matched: string[]; category: string; tier: "stopword" | "ai";
}): Record<string, unknown> {
  return {
    user_id: a.userId, action: a.action, item_type: a.itemType, item_id: a.itemId,
    matched_words: a.matched, category: a.category, result: "blocked", tier: a.tier,
  };
}

export function reviewQueueItem(a: { userId: string; itemType: string; itemId: string }): Record<string, unknown> {
  return { user_id: a.userId, item_type: a.itemType, item_id: a.itemId, status: "pending" };
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run supabase/functions/_shared/__tests__/moderation-source.test.ts`
Expected: 6 passed.

- [ ] **Step 5: Make the snapshot column optional**

Create `supabase/migrations/20261001100200_moderation_snapshot_optional.sql`:
```sql
-- The review queue becomes a list of references. New code writes no snapshot;
-- old code that still writes one keeps working until it is redeployed.
-- 20261001100300 wipes the old copies and forbids new ones.
ALTER TABLE public.moderation_review_queue ALTER COLUMN content_snapshot DROP NOT NULL;
```

- [ ] **Step 6: Change `moderate-content`**

In `supabase/functions/moderate-content/index.ts`, add `import { blockedModerationEvent, reviewQueueItem } from "../_shared/moderation-source.ts";`, then:

1. Replace the blocked insert (lines 150-161, including `const snippet = …`) with:
```ts
      await admin.from("moderation_events").insert(blockedModerationEvent({
        userId: user.id, action, itemType, itemId, matched, category: hitCategory, tier: "stopword",
      }));
```
2. Replace the queue insert (lines 191-201) with:
```ts
    // Queue a reference for the async AI review. The worker reads the note
    // live, and only while it is still shared; no copy of the text is kept.
    if (itemId) {
      try {
        await admin.from("moderation_review_queue").insert(reviewQueueItem({ userId: user.id, itemType, itemId }));
      } catch (_) {
        // fail silently — share should still proceed
      }
    }
```

- [ ] **Step 7: Change `ai-moderate-content`**

In `supabase/functions/ai-moderate-content/index.ts`, add
```ts
import { blockedModerationEvent, loadSharedNoteForReview } from "../_shared/moderation-source.ts";
import { recordStaffAccess } from "../_shared/staff-access.ts";
```
Replace the top of the per-item loop (`const classification = await classifyContent(admin, item.content_snapshot, item.user_id);`) with:
```ts
        const note = await loadSharedNoteForReview(admin, item.item_id, item.user_id);
        if (!note) {
          // Unshared or deleted before review: nothing public left to check.
          await admin.from("moderation_review_queue")
            .update({ status: "skipped", reviewed_at: new Date().toISOString() })
            .eq("id", item.id);
          results.push({ id: item.id, status: "skipped" });
          continue;
        }
        await recordStaffAccess(admin, {
          subjectUserId: item.user_id, actorUserId: null, actorKind: "system",
          action: "moderation_review", noteId: item.item_id,
        });
        const classification = await classifyContent(admin, note.text, item.user_id);
```
In the violation branch, replace the `moderation_events` insert with:
```ts
          await admin.from("moderation_events").insert(blockedModerationEvent({
            userId: item.user_id, action: "share_note", itemType: item.item_type, itemId: item.item_id,
            matched: [], category: classification.category ?? "policy violation", tier: "ai",
          }));
```
replace `const noteTitle = extractTitle(item.content_snapshot);` with `const noteTitle = note.title;`, delete the now unused `extractTitle` function, and in **both** queue updates (violation and reviewed) delete the line `ai_reason: classification.reason,` so the model's explanation, which can quote the note, is never stored. The `recordStaffAccess` throw lands in the existing `catch`, which counts a retry, so a log outage delays the review and never skips the log.

- [ ] **Step 8: Drop the "AI Reason" column from the panel**

In `src/components/admin/ModerationPanel.tsx`, delete `<TableHead>AI Reason</TableHead>` (line 238) and the matching `<TableCell …>{item.ai_reason || "—"}</TableCell>` (line 258), and change both skeleton and empty-state `colSpan`/`length` values in the review table from 8 to 7. In the status-colour switch (around line 211), add `case "skipped": return "bg-muted text-muted-foreground border-border";`. Leave `ai_reason: null` in the retry reset at line 200 as it is: it still clears old values.

- [ ] **Step 9: Check the functions and run all tests**

Run: `npm run check:functions && npm test && npx tsc --noEmit -p tsconfig.app.json`
Expected: all pass.

- [ ] **Step 10: Commit**

```bash
git add supabase/migrations/20261001100200_moderation_snapshot_optional.sql supabase/functions/_shared/moderation-source.ts supabase/functions/_shared/__tests__/moderation-source.test.ts supabase/functions/moderate-content/index.ts supabase/functions/ai-moderate-content/index.ts src/components/admin/ModerationPanel.tsx
git commit -m "Moderation keeps references, not copies: the AI review reads a shared note live"
```

---

### Task 4: Log every staff action in the edge functions

**Files:**
- Modify: `supabase/functions/_shared/note-ai-processing.ts:6-13` and `:30-35`
- Test: `supabase/functions/_shared/__tests__/note-ai-processing.test.ts` (extend the admin test near line 102)
- Modify: `supabase/functions/process-note/index.ts` (around line 2830, the deps object)
- Modify: `supabase/functions/admin-delete-user/index.ts:65-70`
- Modify: `supabase/functions/ensure-token-allowance/index.ts:108-112`
- Conditional: `supabase/functions/admin-normalize/index.ts` (only if Task 0 Step 4 found it still deployed)

**Interfaces:**
- Consumes: `recordStaffAccess`, `StaffAccessEntry` (Task 1).
- Produces: `Dependencies.recordStaffAccess: (e: StaffAccessEntry) => Promise<void>` on `handleNoteAIRequest`'s deps.

- [ ] **Step 1: Write the failing tests**

In `supabase/functions/_shared/__tests__/note-ai-processing.test.ts`, directly after the existing `admin_reanalysis` test (ends near line 105), add:
```ts
 it('records an admin re-analysis in the owner staff log before queueing it',async()=>{
  const {deps,calls}=fixture();
  const logged:any[]=[];
  (deps as any).findNote=async()=>({id:'n',user_id:'owner'});
  (deps as any).isAdmin=async()=>true;
  (deps.jobs as any).reanalyze=async()=>{calls.push('reanalyze');return {id:'j',state:'pending'}};
  (deps as any).recordStaffAccess=async(e:any)=>{logged.push(e);calls.push('log');};
  expect((await handleNoteAIRequest({note_id:'n',reason:'admin_reanalysis'},'Bearer user',deps as any)).status).toBe(202);
  expect(calls).toEqual(['log','reanalyze']);
  expect(logged).toEqual([{subjectUserId:'owner',actorUserId:'u',actorKind:'admin',action:'reanalyze_note',noteId:'n'}]);
 });
 it('does not re-analyse when the staff log cannot be written',async()=>{
  const {deps,calls}=fixture();
  (deps as any).findNote=async()=>({id:'n',user_id:'owner'});
  (deps as any).isAdmin=async()=>true;
  (deps.jobs as any).reanalyze=async()=>{calls.push('reanalyze');return {id:'j',state:'pending'}};
  (deps as any).recordStaffAccess=async()=>{throw new Error('staff access not recorded: down')};
  expect((await handleNoteAIRequest({note_id:'n',reason:'admin_reanalysis'},'Bearer user',deps as any)).status).toBe(503);
  expect(calls).toEqual([]);
 });
```
(`fixture()` authenticates every caller as `'u'`, which is why `actorUserId` is `'u'`.)

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run supabase/functions/_shared/__tests__/note-ai-processing.test.ts`
Expected: the two new tests FAIL (calls lack `'log'`; the second returns 202).

- [ ] **Step 3: Implement**

In `supabase/functions/_shared/note-ai-processing.ts`, add `import type { StaffAccessEntry } from './staff-access.ts';`, add `recordStaffAccess: (e: StaffAccessEntry) => Promise<void>;` to `Dependencies`, and replace the admin line
```ts
 if(admin){const job=await deps.jobs.reanalyze(note.user_id,body.note_id,'analysis');return reply(202,{ok:true,queued:true,processing:false,job_id:job?.id,state:job?.state});}
```
with
```ts
 if(admin){
  // Staff action on someone's note: in their log first, or not at all.
  try{await deps.recordStaffAccess({subjectUserId:note.user_id,actorUserId:userId,actorKind:'admin',action:'reanalyze_note',noteId:body.note_id});}
  catch{return reply(503,{error:'Staff access log unavailable'});}
  const job=await deps.jobs.reanalyze(note.user_id,body.note_id,'analysis');return reply(202,{ok:true,queued:true,processing:false,job_id:job?.id,state:job?.state});
 }
```
In `supabase/functions/process-note/index.ts`, add `import { recordStaffAccess } from "../_shared/staff-access.ts";` and, in the deps object right after the `isAdmin:` entry (lines 2830-2834), add `recordStaffAccess: (e) => recordStaffAccess(supabase, e),`. `supabase` there is the service-role client the neighbouring `findNote` and `isAdmin` already use.

- [ ] **Step 4: Run the tests and watch them pass**

Run: `npx vitest run supabase/functions/_shared/__tests__/note-ai-processing.test.ts`
Expected: the existing admin test (line 100) now fails with 503, because `fixture()` has no `recordStaffAccess` and the call throws. Add `recordStaffAccess:async()=>{},` to the `deps` object in `fixture()` (line 95) and run again. Expected: all pass.

- [ ] **Step 5: Log account deletion by an admin**

In `supabase/functions/admin-delete-user/index.ts`, add `import { recordStaffAccess } from "../_shared/staff-access.ts";` and insert right before `const storage = await removeUserStorage(adminClient, target_user_id);` (line 70):
```ts
    // Recorded before anything is removed: a deletion that is not in the log did not happen.
    try {
      await recordStaffAccess(adminClient, { subjectUserId: target_user_id, actorUserId: caller.id, actorKind: "admin", action: "delete_account" });
    } catch (e) {
      console.error("[admin-delete-user] staff access not recorded:", e instanceof Error ? e.message : e);
      return json({ error: "Staff access log unavailable" }, 503);
    }
```
The row outlives the account on purpose (no foreign key): it is the record that the deletion was an admin's.

- [ ] **Step 6: Log an admin setting up another user's credits**

In `supabase/functions/ensure-token-allowance/index.ts`, add `import { recordStaffAccess } from "../_shared/staff-access.ts";` and replace the "If targeting another user, require admin" block (lines 108-112) with:
```ts
    // If targeting another user, require admin, and record it in their log first.
    if (callerId && targetUserId !== callerId) {
      const denied = await requireAdmin();
      if (denied) return denied;
      try {
        await recordStaffAccess(db, { subjectUserId: targetUserId, actorUserId: callerId, actorKind: "admin", action: "ensure_allowance" });
      } catch (e) {
        console.error("[ensure-token-allowance] staff access not recorded:", e instanceof Error ? e.message : e);
        return json({ error: "Staff access log unavailable" }, 503);
      }
    }
```
The batch path (`batch_init`, every account at once, admin or service role) is not logged per user: it only creates the month's empty allowance row that the user's own first request would create anyway, and reads no content.

- [ ] **Step 7 (only if `admin-normalize` is still deployed): remove the shared-key door**

If Task 0 found `admin-normalize` deployed, the fact-store go-live was rolled back and the function keeps its `x-admin-key` door, which lets whoever holds `MCP_ACCESS_KEY` act on any account unrecorded. In `supabase/functions/admin-normalize/index.ts`, delete `const adminKey = …`, `const provided = …` and the `!(provided && provided === adminKey) &&` clause of the guard, and update the comment above it to "Accept the service-role key (server-side callers) or the scheduler's shared key". Then run `npm run check:functions && npx vitest run supabase/functions/_shared/__tests__/normalization-callers.test.ts`. Otherwise skip this step.

- [ ] **Step 8: Check and commit**

Run: `npm run check:functions && npm test`
Expected: all pass.
```bash
git add supabase/functions/_shared/note-ai-processing.ts supabase/functions/_shared/__tests__/note-ai-processing.test.ts supabase/functions/process-note/index.ts supabase/functions/admin-delete-user/index.ts supabase/functions/ensure-token-allowance/index.ts
git commit -m "Record admin re-analysis and account deletion in the owner's staff access log"
```

---

### Task 5: Remove admin read access to user content, and keep it removed

**Files:**
- Create: `supabase/migrations/20261001100300_remove_admin_content_reads.sql`
- Create: `scripts/check-admin-read-policies.mjs`
- Modify: `scripts/test-admin-privacy.sql` (extend)
- Modify: `package.json` (`test` script), `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: `admin_user_directory` etc. (Task 2): the Admin page must already be off direct `profiles` reads before this lands.
- Produces: the allowlist of tables an admin may still read, identical in the migration and the checker: `user_roles`, `ai_allowance_periods`, `user_suspensions`, `llm_usage_events`, `llm_call_configs`, `moderation_stopwords`, `moderation_events`, `moderation_review_queue`, `ai_credit_settings`.

- [ ] **Step 1: Write the static checker**

Create `scripts/check-admin-read-policies.mjs`:
```js
#!/usr/bin/env node
/**
 * Fail if any migration leaves an admin able to READ a table outside the
 * allowlist. Replays every CREATE/DROP POLICY (and DROP TABLE) in migration
 * order, then looks at the surviving SELECT/ALL policies that mention is_admin
 * or the 'admin' role. Level 1 privacy (docs/superpowers/plans/2026-09-29-
 * admin-privacy-and-avatar-removal.md): staff get account and billing data,
 * never content. Keep ALLOWED identical to the list in
 * supabase/migrations/20261001100300_remove_admin_content_reads.sql.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ALLOWED = new Set([
  "user_roles", "ai_allowance_periods", "user_suspensions", "llm_usage_events",
  "llm_call_configs", "moderation_stopwords", "moderation_events",
  "moderation_review_queue", "ai_credit_settings",
]);
const dir = fileURLToPath(new URL("../supabase/migrations/", import.meta.url));
const norm = (t) => t.replace(/"/g, "").replace(/^public\./i, "");
const state = new Map();
for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
  const sql = readFileSync(join(dir, file), "utf8").replace(/--[^\n]*/g, "");
  const re = /(CREATE|DROP)\s+POLICY\s+(?:IF\s+EXISTS\s+)?"([^"]+)"\s+ON\s+([\w."]+)([\s\S]*?);|DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?([\w."]+)/gi;
  for (const m of sql.matchAll(re)) {
    if (m[5]) {
      const t = norm(m[5]);
      for (const k of [...state.keys()]) if (k.startsWith(`${t}|`)) state.delete(k);
      continue;
    }
    const key = `${norm(m[3])}|${m[2]}`;
    if (m[1].toUpperCase() === "DROP") state.delete(key);
    else state.set(key, { file, body: m[4].replace(/\s+/g, " ") });
  }
}
const bad = [];
for (const [key, { file, body }] of state) {
  const [table, name] = key.split("|");
  const reads = /FOR\s+(SELECT|ALL)\b/i.test(body) || !/FOR\s+(INSERT|UPDATE|DELETE)\b/i.test(body);
  if (reads && /is_admin|'admin'/i.test(body) && !ALLOWED.has(table)) bad.push(`${table}: "${name}" (${file})`);
}
if (bad.length) {
  console.error("Admin read access to user content (Level 1 privacy forbids it):\n  " + bad.join("\n  "));
  process.exit(1);
}
console.log(`admin read policies: ok (${state.size} policies replayed)`);
```
A policy with no `FOR` clause is `FOR ALL`, which is why `reads` is true when no write-only `FOR` is present.

- [ ] **Step 2: Run it and watch it fail**

Run: `node scripts/check-admin-read-policies.mjs`
Expected: exit 1, listing `activity_events`, `agent_instructions`, `media_analysis`, `note_chunks`, `profile_categories`, `profile_entries`, `profile_views`, `profiles`. If it lists anything else, add that table to the migration in Step 4, or to the allowlist in both places only if the table holds no user-written content.

- [ ] **Step 3: Extend the SQL test**

In `scripts/test-admin-privacy.sql`, insert **before** the `\ir …20261001100100…` line (so the fixtures carry the old rules; note there is deliberately no `profile_entries` or `profile_categories`, to prove the missing-table guard):
```sql
CREATE TABLE public.note_chunks(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, content text);
CREATE TABLE public.media_analysis(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, extracted_text text);
CREATE TABLE public.agent_instructions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, instruction text);
CREATE TABLE public.profile_views(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, name text);
CREATE TABLE public.activity_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_id uuid NOT NULL, action text);
CREATE TABLE public.moderation_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, flagged_content text, result text DEFAULT 'cleared');
CREATE TABLE public.moderation_review_queue(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, item_id uuid NOT NULL, content_snapshot text, ai_reason text, status text DEFAULT 'pending');
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['note_chunks','media_analysis','agent_instructions','profile_views'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  EXECUTE format('CREATE POLICY own ON public.%I FOR ALL TO authenticated USING (user_id = auth.uid())', t);
  EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
 END LOOP; END $$;
CREATE POLICY "Admins can view all note chunks" ON public.note_chunks FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));
CREATE POLICY "Admins can view all media analysis" ON public.media_analysis FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));
CREATE POLICY "Admins can view all agent instructions" ON public.agent_instructions FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));
CREATE POLICY "Admins can view all profile views" ON public.profile_views FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));
ALTER TABLE public.activity_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own events" ON public.activity_events FOR SELECT TO authenticated USING (actor_id = auth.uid() OR public.is_admin(auth.uid()));
GRANT SELECT ON public.activity_events TO authenticated;
ALTER TABLE public.moderation_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.moderation_review_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can view moderation events" ON public.moderation_events FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));
CREATE POLICY "Admins can view review queue" ON public.moderation_review_queue FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));
GRANT SELECT ON public.moderation_events, public.moderation_review_queue TO authenticated;
INSERT INTO public.note_chunks(user_id,content) VALUES ('b0000000-0000-0000-0000-000000000002','Bea private text'),('a0000000-0000-0000-0000-000000000001','Admin own text');
INSERT INTO public.media_analysis(user_id,extracted_text) VALUES ('b0000000-0000-0000-0000-000000000002','scan');
INSERT INTO public.agent_instructions(user_id,instruction) VALUES ('b0000000-0000-0000-0000-000000000002','be nice');
INSERT INTO public.profile_views(user_id,name) VALUES ('b0000000-0000-0000-0000-000000000002','view');
INSERT INTO public.activity_events(actor_id,action) VALUES ('b0000000-0000-0000-0000-000000000002','profile_update');
INSERT INTO public.moderation_events(user_id,flagged_content,result) VALUES ('b0000000-0000-0000-0000-000000000002','old copy','blocked');
INSERT INTO public.moderation_review_queue(user_id,item_id,content_snapshot,ai_reason) VALUES ('b0000000-0000-0000-0000-000000000002','d0000000-0000-0000-0000-000000000004','old copy','quotes the note');
```
Then, at the end of the file (after the directory assertions), append:
```sql
\ir ../supabase/migrations/20261001100300_remove_admin_content_reads.sql

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','a0000000-0000-0000-0000-000000000001',false);
DO $$BEGIN
 IF (SELECT count(*) FROM public.note_chunks) <> 1 THEN RAISE EXCEPTION 'admin still reads others'' note chunks'; END IF;
 IF (SELECT count(*) FROM public.media_analysis) <> 0 THEN RAISE EXCEPTION 'admin still reads image text'; END IF;
 IF (SELECT count(*) FROM public.agent_instructions) <> 0 THEN RAISE EXCEPTION 'admin still reads agent instructions'; END IF;
 IF (SELECT count(*) FROM public.profile_views) <> 0 THEN RAISE EXCEPTION 'admin still reads profile views'; END IF;
 IF (SELECT count(*) FROM public.activity_events) <> 0 THEN RAISE EXCEPTION 'admin still reads activity'; END IF;
 IF (SELECT count(*) FROM public.profiles) <> 1 THEN RAISE EXCEPTION 'admin still reads every profile'; END IF;
 IF (SELECT count(*) FROM public.moderation_events) <> 1 THEN RAISE EXCEPTION 'moderation events lost'; END IF;
 IF (SELECT count(*) FROM public.moderation_events WHERE flagged_content IS NOT NULL) <> 0 THEN RAISE EXCEPTION 'moderation copy kept'; END IF;
 IF (SELECT count(*) FROM public.moderation_review_queue WHERE content_snapshot IS NOT NULL OR ai_reason IS NOT NULL) <> 0 THEN RAISE EXCEPTION 'queue copy kept'; END IF;
 IF (SELECT count(*) FROM public.admin_user_directory()) <> 3 THEN RAISE EXCEPTION 'directory broken by the drop'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','b0000000-0000-0000-0000-000000000002',false);
DO $$BEGIN
 IF (SELECT count(*) FROM public.note_chunks) <> 1 THEN RAISE EXCEPTION 'owner lost own chunks'; END IF;
 IF (SELECT count(*) FROM public.activity_events) <> 1 THEN RAISE EXCEPTION 'owner lost own activity'; END IF;
 IF (SELECT count(*) FROM public.profiles) <> 1 THEN RAISE EXCEPTION 'owner lost own profile'; END IF;
END $$;
RESET ROLE;
DO $$BEGIN
 BEGIN INSERT INTO public.moderation_review_queue(user_id,item_id,content_snapshot) VALUES ('b0000000-0000-0000-0000-000000000002','d0000000-0000-0000-0000-000000000005','new copy');
  RAISE EXCEPTION 'a new copy was accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN INSERT INTO public.moderation_events(user_id,flagged_content) VALUES ('b0000000-0000-0000-0000-000000000002','new copy');
  RAISE EXCEPTION 'a new event copy was accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
-- The apply-time assertion refuses a leftover admin read rule, whatever its name.
CREATE TABLE public.sneaky(id int, user_id uuid);
CREATE POLICY "renamed admin read" ON public.sneaky FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));
DO $$BEGIN
 BEGIN
  PERFORM private.assert_no_admin_content_reads();
  RAISE EXCEPTION 'assertion missed a renamed admin rule';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE 'Admin read access left on user content:%' THEN RAISE; END IF; END;
END $$;
\echo 'admin privacy: all assertions passed'
```

- [ ] **Step 4: Write the migration**

Create `supabase/migrations/20261001100300_remove_admin_content_reads.sql`:
```sql
-- Level 1 privacy: staff cannot read what users wrote. Admins keep account,
-- billing and moderation-metadata access only. Keep the allowlist identical to
-- scripts/check-admin-read-policies.mjs.
-- Deploy the new moderate-content / ai-moderate-content BEFORE this: the CHECKs
-- below refuse the text copies the old versions still write.

-- 1. Drop the named admin read rules. A table may be gone (fact-store go-live),
--    so each drop is guarded. The statements are written out literally, not
--    built with format(), so scripts/check-admin-read-policies.mjs can see them.
DO $$ BEGIN IF to_regclass('public.note_chunks') IS NOT NULL THEN
  DROP POLICY IF EXISTS "Admins can view all note chunks" ON public.note_chunks; END IF; END $$;
DO $$ BEGIN IF to_regclass('public.media_analysis') IS NOT NULL THEN
  DROP POLICY IF EXISTS "Admins can view all media analysis" ON public.media_analysis; END IF; END $$;
DO $$ BEGIN IF to_regclass('public.profile_entries') IS NOT NULL THEN
  DROP POLICY IF EXISTS "Admins can view all profile entries" ON public.profile_entries; END IF; END $$;
DO $$ BEGIN IF to_regclass('public.profile_categories') IS NOT NULL THEN
  DROP POLICY IF EXISTS "Admins can view all profile categories" ON public.profile_categories; END IF; END $$;
DO $$ BEGIN IF to_regclass('public.profile_views') IS NOT NULL THEN
  DROP POLICY IF EXISTS "Admins can view all profile views" ON public.profile_views; END IF; END $$;
DO $$ BEGIN IF to_regclass('public.agent_instructions') IS NOT NULL THEN
  DROP POLICY IF EXISTS "Admins can view all agent instructions" ON public.agent_instructions; END IF; END $$;
DO $$ BEGIN IF to_regclass('public.profiles') IS NOT NULL THEN
  DROP POLICY IF EXISTS "Admins can view all profiles" ON public.profiles; END IF; END $$;

-- 2. Activity: owner only (it was "own OR admin").
DROP POLICY IF EXISTS "Users can view own events" ON public.activity_events;
CREATE POLICY "Users can view own events" ON public.activity_events
  FOR SELECT TO authenticated USING (actor_id = auth.uid());

-- 3. Moderation keeps references, never text. Wipe the old copies, refuse new ones.
UPDATE public.moderation_review_queue SET content_snapshot = NULL, ai_reason = NULL
  WHERE content_snapshot IS NOT NULL OR ai_reason IS NOT NULL;
UPDATE public.moderation_events SET flagged_content = NULL WHERE flagged_content IS NOT NULL;
ALTER TABLE public.moderation_review_queue
  ADD CONSTRAINT moderation_review_queue_no_copy CHECK (content_snapshot IS NULL AND ai_reason IS NULL);
ALTER TABLE public.moderation_events
  ADD CONSTRAINT moderation_events_no_copy CHECK (flagged_content IS NULL);

-- 4. Refuse to finish if any admin read rule is left outside the allowlist,
--    whatever it is called (production has drifted from the repo before).
CREATE SCHEMA IF NOT EXISTS private;
CREATE OR REPLACE FUNCTION private.assert_no_admin_content_reads() RETURNS void
LANGUAGE plpgsql AS $$
DECLARE bad text;
BEGIN
  SELECT string_agg(format('%s.%s "%s"', schemaname, tablename, policyname), '; ') INTO bad
  FROM pg_policies
  WHERE cmd IN ('SELECT', 'ALL')
    AND (coalesce(qual, '') ~* 'is_admin|''admin''' OR coalesce(with_check, '') ~* 'is_admin|''admin''')
    AND NOT (schemaname = 'public' AND tablename = ANY (ARRAY[
      'user_roles','ai_allowance_periods','user_suspensions','llm_usage_events',
      'llm_call_configs','moderation_stopwords','moderation_events',
      'moderation_review_queue','ai_credit_settings']));
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'Admin read access left on user content: %', bad;
  END IF;
END $$;
REVOKE ALL ON FUNCTION private.assert_no_admin_content_reads() FROM PUBLIC, anon, authenticated;
SELECT private.assert_no_admin_content_reads();
```

- [ ] **Step 5: Run the SQL test and the checker and watch them pass**

Run:
```bash
dropdb --if-exists admin_privacy_test; createdb admin_privacy_test && psql -v ON_ERROR_STOP=1 -d admin_privacy_test -f scripts/test-admin-privacy.sql
node scripts/check-admin-read-policies.mjs
```
Expected: `admin directory: all assertions passed`, `admin privacy: all assertions passed`, `admin read policies: ok (…)`.

- [ ] **Step 6: Wire the checker into `npm test` and CI**

In `package.json` change `"test"` to:
```json
"test": "node scripts/check-edge-functions.mjs && node scripts/check-admin-read-policies.mjs && vitest run",
```
CI's `check` job already runs `npm test`, so nothing else changes there.

- [ ] **Step 7: Run everything and commit**

Run: `npm test`
Expected: all pass.
```bash
git add supabase/migrations/20261001100300_remove_admin_content_reads.sql scripts/check-admin-read-policies.mjs scripts/test-admin-privacy.sql package.json
git commit -m "Remove admin read access to user content and fail the build if it comes back"
```

---

### Task 6: "Staff access" in Settings

**Files:**
- Create: `src/components/settings/StaffAccessCard.tsx`
- Test: `src/components/settings/__tests__/StaffAccessCard.test.tsx`
- Modify: `src/pages/Settings.tsx` (Account tab)
- Modify: `src/integrations/supabase/types.ts` (`my_staff_access_log`)

**Interfaces:**
- Consumes: `public.my_staff_access_log()` (Task 1).
- Produces: `export function StaffAccessCard(): JSX.Element`; `export function describeStaffAction(action: string): string`.

- [ ] **Step 1: Write the failing test**

Create `src/components/settings/__tests__/StaffAccessCard.test.tsx`:
```tsx
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));

import { StaffAccessCard, describeStaffAction } from "@/components/settings/StaffAccessCard";

function renderCard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><StaffAccessCard /></QueryClientProvider>);
}

beforeEach(() => rpc.mockReset());

describe("StaffAccessCard", () => {
  it("says so plainly when nobody has acted on the account", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    renderCard();
    expect(await screen.findByText("Nobody at Menerio has taken any action on your account.")).toBeInTheDocument();
    expect(rpc).toHaveBeenCalledWith("my_staff_access_log");
  });

  it("lists each entry in plain words", async () => {
    rpc.mockResolvedValue({ data: [
      { action: "moderation_review", actor_kind: "system", note_id: "n1", created_at: "2026-10-02T10:00:00Z" },
      { action: "user_roles_update", actor_kind: "admin", note_id: null, created_at: "2026-10-01T09:00:00Z" },
    ], error: null });
    renderCard();
    expect(await screen.findByText("Our automatic check read a note you shared publicly")).toBeInTheDocument();
    expect(screen.getByText("An administrator changed your plan")).toBeInTheDocument();
  });

  it("shows an error line rather than an empty list when the log cannot load", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "down" } });
    renderCard();
    expect(await screen.findByText("The staff access list could not be loaded. Please try again later.")).toBeInTheDocument();
  });
});

describe("describeStaffAction", () => {
  it("falls back to a general sentence for an action it does not know", () => {
    expect(describeStaffAction("something_new")).toBe("An administrator took an action on your account");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/components/settings/__tests__/StaffAccessCard.test.tsx`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the component**

Create `src/components/settings/StaffAccessCard.tsx`:
```tsx
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const LABELS: Record<string, string> = {
  moderation_review: "Our automatic check read a note you shared publicly",
  reanalyze_note: "An administrator re-ran the AI analysis on one of your notes",
  ensure_allowance: "An administrator set up your monthly AI credits",
  user_roles_insert: "An administrator set your plan",
  user_roles_update: "An administrator changed your plan",
  user_roles_delete: "An administrator removed your plan",
  ai_allowance_periods_insert: "An administrator set your AI credits",
  ai_allowance_periods_update: "An administrator changed your AI credits",
  ai_allowance_periods_delete: "An administrator removed your AI credits",
  user_suspensions_insert: "An administrator changed your account status",
  user_suspensions_update: "An administrator changed your account status",
  user_suspensions_delete: "An administrator changed your account status",
};

export function describeStaffAction(action: string): string {
  return LABELS[action] ?? "An administrator took an action on your account";
}

interface Entry { action: string; actor_kind: string; note_id: string | null; created_at: string }

export function StaffAccessCard() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["my-staff-access-log"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("my_staff_access_log");
      if (error) throw new Error(error.message);
      return (data ?? []) as Entry[];
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Staff access</CardTitle>
        <CardDescription>
          Menerio staff cannot open your notes, people or moments. Anything staff or our systems do to your account is listed here.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? null : isError ? (
          <p className="text-sm text-muted-foreground">The staff access list could not be loaded. Please try again later.</p>
        ) : !data?.length ? (
          <p className="text-sm text-muted-foreground">Nobody at Menerio has taken any action on your account.</p>
        ) : (
          <ul className="space-y-2">
            {data.map((e, i) => (
              <li key={`${e.created_at}-${i}`} className="flex justify-between gap-4 text-sm">
                <span>{describeStaffAction(e.action)}</span>
                <span className="shrink-0 text-muted-foreground">{format(new Date(e.created_at), "MMM d, yyyy HH:mm")}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
```
`delete_account` has no label on purpose: the account no longer exists to read it.

- [ ] **Step 4: Add the RPC to the types and the card to Settings**

In `src/integrations/supabase/types.ts` `Functions`, add:
```ts
      my_staff_access_log: {
        Args: Record<PropertyKey, never>
        Returns: { action: string; actor_kind: string; created_at: string; note_id: string | null }[]
      }
```
In `src/pages/Settings.tsx`, add `import { StaffAccessCard } from "@/components/settings/StaffAccessCard";` and render `<StaffAccessCard />` inside `<TabsContent value="account">`, directly after the existing Account `</Card>`, wrapped with the tab's existing spacing (`<div className="space-y-6">…</div>` if the tab has none).

- [ ] **Step 5: Run the tests and watch them pass**

Run: `npx vitest run src/components/settings/__tests__/StaffAccessCard.test.tsx && npx tsc --noEmit -p tsconfig.app.json`
Expected: 4 passed, no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/settings/StaffAccessCard.tsx src/components/settings/__tests__/StaffAccessCard.test.tsx src/pages/Settings.tsx src/integrations/supabase/types.ts
git commit -m "Settings shows every staff action on the account"
```

---

### Task 7: Remove profile pictures from the app

**Files:**
- Modify: `src/pages/Settings.tsx` (Picture tab, `handleAvatarUpload`, related state and imports)
- Modify: `src/pages/Wizard.tsx:76,93,125,134-146,260-275`
- Modify: `src/contexts/AuthContext.tsx:41,86`
- Modify: `src/pages/Admin.tsx` (any avatar leftovers after Task 2)
- Delete: `src/lib/avatar-url.ts`
- Modify: `supabase/functions/_shared/delete-user-storage.ts:28`
- Create: `src/pages/__tests__/NoAvatar.test.ts`

**Interfaces:**
- Produces: `USER_STORAGE_BUCKETS = ["note-attachments"] as const`; the `Profile` type in `AuthContext` without `avatar_url`.

- [ ] **Step 1: Write the failing guard test**

Create `src/pages/__tests__/NoAvatar.test.ts`:
```ts
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { USER_STORAGE_BUCKETS } from "../../../supabase/functions/_shared/delete-user-storage";

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(n) ? [p] : [];
  });
}

describe("profile pictures are gone", () => {
  it("no app code touches the avatars bucket or the avatar_url column", () => {
    const offenders = files("src")
      .filter((f) => !f.includes("integrations/supabase/types.ts") && !f.includes("__tests__"))
      .filter((f) => /from\("avatars"\)|avatar_url|avatar-url/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });

  it("account deletion no longer lists the avatars bucket", () => {
    expect([...USER_STORAGE_BUCKETS]).toEqual(["note-attachments"]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/pages/__tests__/NoAvatar.test.ts`
Expected: FAIL listing `AuthContext.tsx`, `avatar-url.ts`, `Admin.tsx` (if anything is left), `Settings.tsx`, `Wizard.tsx`; and the bucket list still contains `avatars`.

- [ ] **Step 3: Remove the code**

1. `src/pages/Settings.tsx`: delete the `<TabsTrigger value="avatar" …>Picture</TabsTrigger>` line (276), the whole `{/* ── Avatar Tab ── */}` `<TabsContent value="avatar">…</TabsContent>` block, `handleAvatarUpload`, the `avatarUploading` state, `fileInputRef` if nothing else uses it, `const avatarPublicUrl = …` (line 141), and the `avatarPublicUrl as avatarUrlFor` import (line 6). Remove `Camera`, `Loader2`, `Avatar`, `AvatarImage`, `AvatarFallback` and `useRef` from the imports if nothing else in the file uses them; keep `initials` only if still used. Remove `"avatar"` from the `SETTINGS_TABS` list: the page already sends an unknown `?tab=` to Account (lines 100-103), so an old `?tab=avatar` bookmark lands there.
2. `src/pages/Wizard.tsx`: delete the `avatarUrl` and `uploading` state (lines 76-77), `setAvatarUrl(profile.avatar_url);` (line 93), `avatar_url: avatarUrl,` (line 125), `handleAvatarUpload` (lines 134-146), and the whole avatar block in step 1 (the `<div className="flex flex-col items-center gap-4">…</div>` holding `<Avatar>` and "Click to upload"). Change the subtitle "Help others recognize you." to "Tell us what to call you.". Remove the `avatarPublicUrl`, `Avatar*` and `Upload` imports if unused. The comment in `saveProfile` becomes "Moving on anyway would drop the name without a word."
3. `src/contexts/AuthContext.tsx`: delete `avatar_url: string | null;` (line 41) and change the select at line 86 to `.select("id, display_name")`.
4. `src/pages/Admin.tsx`: confirm no `avatar_url`, `avatarPublicUrl` or `AvatarImage` is left (Task 2 removed them).
5. Delete `src/lib/avatar-url.ts`.
6. `supabase/functions/_shared/delete-user-storage.ts`: change line 28 to `export const USER_STORAGE_BUCKETS = ["note-attachments"] as const;`, and in the header comment replace the first paragraph's "used to clear the `avatars` bucket and nothing else" sentence with "Profile pictures (the old `avatars` bucket) were removed on 2026-10; attachments are the only per-user files."

- [ ] **Step 4: Run the guard, all tests, type check and build**

Run: `npx vitest run src/pages/__tests__/NoAvatar.test.ts && npm test && npx tsc --noEmit -p tsconfig.app.json && npm run build && npm run lint -- --max-warnings 1453`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add -A src/pages/Settings.tsx src/pages/Wizard.tsx src/contexts/AuthContext.tsx src/pages/Admin.tsx src/lib/avatar-url.ts supabase/functions/_shared/delete-user-storage.ts src/pages/__tests__/NoAvatar.test.ts
git commit -m "Remove profile pictures: nobody but the admin ever saw them"
```

---

### Task 8: Privacy policy section

**Files:**
- Modify: `src/pages/Privacy.tsx` (new section after "Use of Your Personal Data", before "Retention")

- [ ] **Step 1: Show Michael the text first**

This is published legal text in his product's voice. Send him the draft below as one card: what it is, that it states what the code now guarantees, the full text, and the choice (1) publish as is, (2) publish with his edits, (3) hold it. Continue with Task 9 meanwhile; Task 9 ships the page only if he chose 1 or 2.

Draft (no em dashes, plain words):

> **Who can see your data**
>
> Your notes, people, moments and everything else you keep in Menerio are visible only to you. Other users cannot see them. Menerio's administrators have no screen and no database permission that shows them.
>
> There are three exceptions, and we want you to know them:
>
> - **Notes you share publicly.** Anyone with the link can read a note you share. An automatic check reads it once to keep public links free of abuse.
> - **AI features.** To summarise, tag and search your notes, Menerio sends their text to the AI provider that does the work (currently OpenRouter and the Lovable AI gateway, and directly OpenAI, Anthropic, Google and Mistral). They receive it to answer that request, under their own privacy terms.
> - **The servers themselves.** Like every online service that is not end-to-end encrypted, the people who run Menerio's servers can technically reach the database. We do not look. Anything staff or our systems do to your account is listed in Settings, under Account, "Staff access".

- [ ] **Step 2: Add the approved text**

Add it as a new `<section>` in `src/pages/Privacy.tsx`, matching the heading and paragraph classes of the neighbouring sections (`text-foreground` for `<strong>`, the same `<ul>` classes as the "Use of Your Personal Data" list).

- [ ] **Step 3: Build and commit**

Run: `npm run build`
```bash
git add src/pages/Privacy.tsx
git commit -m "Privacy policy: say plainly who can see a user's data"
```

---

### Task 9: Rollout, phase 1 (additive; nothing is taken away yet)

**Files:** none. Production only.

Order matters: the database functions first (they are additive and harmless to the old code), then the push that publishes the new Admin page (it calls them), then the edge functions.

- [ ] **Step 1: Get CI green on the branch with Tasks 1-7 (and 8 if approved)**

Task 5's migration file is part of the branch, but it is **not** applied in this phase. CI runs it only against disposable databases.

- [ ] **Step 2: Apply migrations A, B, C and record them (before the push)**

```bash
for m in 20261001100000_staff_access_log 20261001100100_admin_directory_rpcs 20261001100200_moderation_snapshot_optional; do
  bash scripts/rehearsal/prod-apply.sh "$(cat supabase/migrations/$m.sql)"
  v=${m%%_*}; n=${m#*_}
  bash scripts/rehearsal/prod-apply.sh "insert into supabase_migrations.schema_migrations(version, name) values ('$v', '$n') on conflict do nothing"
done
```
Expected: each call returns `[]` without an error. Stop at the first error.

- [ ] **Step 3: Merge to `main` and push**

This publishes the new frontend (Admin page on the new functions, Staff access card, no pictures). Old edge functions keep running meanwhile; the old `moderate-content` still writes a snapshot, which migration C still allows.

- [ ] **Step 4: Deploy every function that imports a changed shared module**

Run: `grep -rlE "staff-access|moderation-source|note-ai-processing|delete-user-storage" supabase/functions --include=index.ts | xargs -n1 dirname | xargs -n1 basename | sort -u`
Deploy that list (it contains at least `ai-moderate-content`, `moderate-content`, `process-note`, `admin-delete-user`, `delete-my-account`, `ensure-token-allowance`) one by one with `npx supabase@latest functions deploy <name> --project-ref tjeapelvjlmbxafsmjef --use-api`, stopping at the first failure. `ensure-token-allowance` does not import a changed shared module but changed itself in Task 4, so deploy it even if the grep misses it.

- [ ] **Step 5: Verify phase 1 live**

- The Admin page opens as Michael, and shows user counts, the user list, the usage tab names and the moderation tab.
- `bash scripts/rehearsal/prod-read.sh "select count(*) from private.staff_access_log"` returns a number and no error.
- Share a test note from Michael's account, click "Process now" in the moderation tab, then check: `select status, content_snapshot is null as no_copy from public.moderation_review_queue order by created_at desc limit 1` shows `reviewed` (or `violation`) and `no_copy = true`. `select action, actor_kind from private.staff_access_log order by created_at desc limit 1` shows `moderation_review | system`. Unshare the test note.
- Settings, Account, as Michael, shows the "Staff access" card with that entry.

---

### Task 10: Rollout, phase 2 (take the access away, retire the bucket)

**Files:**
- Create: `supabase/migrations/20261001100400_retire_avatars.sql`
- Create: `scripts/oneoff/empty-avatars-bucket.mjs`

- [ ] **Step 1: Confirm the new moderation code is what runs**

Run: `npx supabase@latest functions list --project-ref tjeapelvjlmbxafsmjef | grep -E "moderate-content"` and compare the updated-at times with Task 9 Step 4. Expected: both deployed after the Task 9 merge. If not, redeploy them first.

- [ ] **Step 2: Apply migration D and record it**

```bash
bash scripts/rehearsal/prod-apply.sh "$(cat supabase/migrations/20261001100300_remove_admin_content_reads.sql)"
bash scripts/rehearsal/prod-apply.sh "insert into supabase_migrations.schema_migrations(version, name) values ('20261001100300', 'remove_admin_content_reads') on conflict do nothing"
```
Expected: no error. If it fails with "Admin read access left on user content: …", nothing was applied (the migration runs as one transaction). Add each listed rule to step 1 of the migration (or, for a table without user content, to both allowlists), commit, and apply again.

- [ ] **Step 3: Verify as an admin, counts only**

First the structural check, which is the one that must pass:
```bash
bash scripts/rehearsal/prod-read.sh "select private.assert_no_admin_content_reads()"
```
Expected: one row with an empty value and no error.

Then the behavioural check, as the admin account. If the management API refuses the `set local role` inside its read-only transaction, skip it and rely on the check above plus the Admin page walk-through.
```bash
bash scripts/rehearsal/prod-read.sh "begin; set local role authenticated; select set_config('request.jwt.claim.sub', (select user_id::text from public.user_roles where role='admin' limit 1), true); select set_config('request.jwt.claims', json_build_object('sub', (select user_id from public.user_roles where role='admin' limit 1), 'role', 'authenticated')::text, true); select (select count(*) from public.note_chunks where user_id <> auth.uid()) as others_chunks, (select count(*) from public.media_analysis where user_id <> auth.uid()) as others_media, (select count(*) from public.profiles where id <> auth.uid()) as others_profiles, (select count(*) from public.agent_instructions where user_id <> auth.uid()) as others_instructions; rollback;"
```
Expected: all four counts `0`. Then open the Admin page as Michael: counts, the user list and the moderation tab still work.

- [ ] **Step 4: Write the avatar retirement migration**

Create `supabase/migrations/20261001100400_retire_avatars.sql`:
```sql
-- Profile pictures are gone from the app. No new uploads, no reads; the files
-- are removed through the Storage API (scripts/oneoff/empty-avatars-bucket.mjs),
-- because Supabase refuses direct deletes from storage tables. The column and
-- the bucket go in 20261008100000, once cached app shells have updated.
DROP POLICY IF EXISTS "Anyone can view avatars" ON storage.objects;
DROP POLICY IF EXISTS "Users can view their own avatar" ON storage.objects;
DROP POLICY IF EXISTS "Users can upload their own avatar" ON storage.objects;
DROP POLICY IF EXISTS "Users can update their own avatar" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their own avatar" ON storage.objects;
UPDATE storage.buckets SET public = false WHERE id = 'avatars';
UPDATE public.profiles SET avatar_url = NULL WHERE avatar_url IS NOT NULL;

-- Sign-up no longer copies a provider photo URL into the profile.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1))
  );
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'free');
  RETURN NEW;
END;
$$;
```
If the apply refuses `UPDATE storage.buckets` (Supabase guards its storage tables), delete that line and instead make the bucket private through the Storage API: add `await db.storage.updateBucket("avatars", { public: false });` to the start of the bucket script in Step 5.

Before writing it, confirm `handle_new_user` was not redefined after `20260307231938` on live: `bash scripts/rehearsal/prod-read.sh "select md5(pg_get_functiondef('public.handle_new_user'::regproc))"` and compare with a local definition from that migration. If live differs, start from the live body (structure only; it holds no user data) and remove only the `avatar_url` parts.

- [ ] **Step 5: Write the bucket script**

Create `scripts/oneoff/empty-avatars-bucket.mjs`:
```js
#!/usr/bin/env node
/**
 * Empty (and with --delete-bucket, delete) the retired `avatars` bucket.
 * Dry run by default: prints counts only. --apply removes the files.
 * Needs SUPABASE_ACCESS_TOKEN; fetches the service key from the management API
 * at runtime and never prints it.
 */
import { createClient } from "@supabase/supabase-js";

const REF = "tjeapelvjlmbxafsmjef";
const apply = process.argv.includes("--apply");
const deleteBucket = process.argv.includes("--delete-bucket");
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) { console.error("SUPABASE_ACCESS_TOKEN is not set"); process.exit(2); }

const keys = await (await fetch(`https://api.supabase.com/v1/projects/${REF}/api-keys`, { headers: { Authorization: `Bearer ${token}` } })).json();
const service = Array.isArray(keys) ? keys.find((k) => k.name === "service_role")?.api_key : undefined;
if (!service) { console.error("service_role key not returned by the management API"); process.exit(2); }
const db = createClient(`https://${REF}.supabase.co`, service, { auth: { persistSession: false } });
const bucket = db.storage.from("avatars");

let total = 0;
for (let guard = 0; guard < 10000; guard++) {
  const { data: folders, error } = await bucket.list("", { limit: 100, offset: apply ? 0 : guard * 100 });
  if (error) { console.error("list failed:", error.message); process.exit(1); }
  if (!folders?.length) break;
  for (const f of folders) {
    const prefix = f.id ? "" : f.name;            // a folder lists with id null
    const { data: items, error: e2 } = prefix ? await bucket.list(prefix, { limit: 1000 }) : { data: [f], error: null };
    if (e2) { console.error("list failed:", e2.message); process.exit(1); }
    const paths = (items ?? []).filter((i) => i.id).map((i) => (prefix ? `${prefix}/${i.name}` : i.name));
    total += paths.length;
    if (apply && paths.length) {
      const { error: e3 } = await bucket.remove(paths);
      if (e3) { console.error("remove failed:", e3.message); process.exit(1); }
    }
  }
  if (folders.length < 100) break;
}
console.log(`${apply ? "removed" : "would remove"} ${total} file(s) from avatars`);
if (deleteBucket) {
  const { error } = await db.storage.deleteBucket("avatars");
  if (error) { console.error("delete bucket failed:", error.message); process.exit(1); }
  console.log("avatars bucket deleted");
}
```

- [ ] **Step 6: Apply the avatar migration, then empty the bucket**

```bash
bash scripts/rehearsal/prod-apply.sh "$(cat supabase/migrations/20261001100400_retire_avatars.sql)"
bash scripts/rehearsal/prod-apply.sh "insert into supabase_migrations.schema_migrations(version, name) values ('20261001100400', 'retire_avatars') on conflict do nothing"
node scripts/oneoff/empty-avatars-bucket.mjs          # dry run: count must equal Task 0's avatar_files
node scripts/oneoff/empty-avatars-bucket.mjs --apply
bash scripts/rehearsal/prod-read.sh "select (select count(*) from storage.objects where bucket_id='avatars') as files, (select public from storage.buckets where id='avatars') as is_public, (select count(*) from public.profiles where avatar_url is not null) as with_avatar"
```
Expected: `files = 0`, `is_public = false`, `with_avatar = 0`.

- [ ] **Step 7: Sign up a test account and delete it**

Create a throwaway account on the live site, finish the wizard (no photo step), open Settings (no Picture tab, Staff access card present), then delete it from Settings. Expected: no errors, and `select count(*) from public.profiles where created_at > now() - interval '15 minutes'` is back to what it was before.

- [ ] **Step 8: Commit the migration and the script, and push**

```bash
git add supabase/migrations/20261001100400_retire_avatars.sql scripts/oneoff/empty-avatars-bucket.mjs
git commit -m "Retire the avatars bucket: no rules, no files, sign-up no longer copies a photo URL"
git push origin main
```

---

### Task 11: Cleanup, at least 7 days after Task 10

**Files:**
- Create: `supabase/migrations/20261008100000_privacy_cleanup_columns.sql`
- Modify: `src/integrations/supabase/types.ts`

- [ ] **Step 1: Check that no client still asks for `avatar_url`**

In the Supabase dashboard's API logs for the last 7 days (Logs Explorer, `edge_logs`), filter requests whose path contains `avatar_url`. Expected: none. If there are any, wait another 7 days and check again; an old cached app shell is still in use.

- [ ] **Step 2: Write the migration**

Create `supabase/migrations/20261008100000_privacy_cleanup_columns.sql`:
```sql
-- The last traces: columns that only ever held pictures or copies of text.
ALTER TABLE public.moderation_review_queue DROP CONSTRAINT IF EXISTS moderation_review_queue_no_copy;
ALTER TABLE public.moderation_review_queue DROP COLUMN IF EXISTS content_snapshot;
ALTER TABLE public.moderation_review_queue DROP COLUMN IF EXISTS ai_reason;
ALTER TABLE public.moderation_events DROP CONSTRAINT IF EXISTS moderation_events_no_copy;
ALTER TABLE public.moderation_events DROP COLUMN IF EXISTS flagged_content;
ALTER TABLE public.profiles DROP COLUMN IF EXISTS avatar_url;
```
Before applying, remove `ai_reason: null` from the retry reset in `ModerationPanel.tsx:200` and ship that frontend change first, or the retry button fails once the column is gone.

- [ ] **Step 3: Update the generated types**

In `src/integrations/supabase/types.ts`, delete `avatar_url` from `profiles` (Row, Insert, Update), `content_snapshot` and `ai_reason` from `moderation_review_queue`, and `flagged_content` from `moderation_events`. Run `npx tsc --noEmit -p tsconfig.app.json && npm test`. Expected: pass.

- [ ] **Step 4: Apply, delete the bucket, verify, commit**

```bash
bash scripts/rehearsal/prod-apply.sh "$(cat supabase/migrations/20261008100000_privacy_cleanup_columns.sql)"
bash scripts/rehearsal/prod-apply.sh "insert into supabase_migrations.schema_migrations(version, name) values ('20261008100000', 'privacy_cleanup_columns') on conflict do nothing"
node scripts/oneoff/empty-avatars-bucket.mjs --apply --delete-bucket
bash scripts/rehearsal/prod-read.sh "select (select count(*) from storage.buckets where id='avatars') as bucket, (select count(*) from information_schema.columns where table_schema='public' and column_name in ('avatar_url','content_snapshot','flagged_content')) as columns_left"
git add supabase/migrations/20261008100000_privacy_cleanup_columns.sql src/integrations/supabase/types.ts src/components/admin/ModerationPanel.tsx
git commit -m "Drop the picture and text-copy columns; delete the avatars bucket"
git push origin main
```
Expected: `bucket = 0`, `columns_left = 0`.

---

## Follow-ups (not in this plan)

- **MCP key in the URL.** `menerio-mcp` accepts `?key=` / `?api_key=` (`index.ts` around line 4266). Keys in URLs land in logs that staff can read, and a key is a whole account. Removing it can break existing connectors, so it needs its own plan: find which clients use the URL form, move them to the header, then remove it.
- **Level 2 "private vault".** An opt-in encrypted section that the AI never reads. A product decision, not a fix.
- **Service-role functions.** 86 functions bypass Row-Level Security and rely on `user_id` filters in code. A static check in the style of `check-admin-read-policies.mjs` could flag a service-role query on a user table without a `user_id` filter.
- **`fact_backup` schema.** The fact-store go-live keeps a snapshot of user facts for its rollback. Drop it once that plan says the rollback window is over.

## Self-review (2026-09-29)

One pass against the code and the Level 1 definition. Changed in the plan as a result:

1. **The static checker could not see the policy drops.** Migration D first built its `DROP POLICY` statements with `format()`, which the checker's parser cannot read, so the build would have stayed red after the fix. The drops are now written out literally, each in its own missing-table guard. Verified: a copy of the checker run over today's 231 migrations lists exactly the 8 expected tables and exits 1; with migration D added it passes (208 policies replayed).
2. **Rollout order.** The Admin page calls the new database functions, so migrations A-C are applied before the push that publishes it, not after.
3. **One staff path was not logged.** `ensure-token-allowance` lets an admin act on another user's credits. It is now logged (Task 4 Step 6), so the privacy text's "anything staff do is listed" is true.
4. **The existing re-analysis test would have broken.** Its fixture has no `recordStaffAccess`, so fail-closed turns it into a 503. Task 4 now says so and adds the no-op.
5. **Search escaping was not really tested.** The `100%` case passed with or without escaping; the test now searches for `%` and `_`, which only escaping gets right.
6. **Smaller fixes:** the assertion function moved to the `private` schema; the checker uses `fileURLToPath` (Windows paths); `"avatar"` leaves `SETTINGS_TABS`; the privacy text names the Lovable AI gateway, which the code also uses; a fallback if Supabase refuses `UPDATE storage.buckets`; a fallback if the live admin impersonation check is refused by the management API.

Checked and left as they are: `match_note_chunks` already refuses other users' ids; `backfill-embeddings` accepts another user only with the service key, never an admin login; `llm_usage_events.metadata` holds ids and token counts, no text; `activity_events.metadata` holds field names only.
