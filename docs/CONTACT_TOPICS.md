# Person conversation topics

Topics are native records belonging to a person. They are separate from notes, reminders, and the Conversation assistant. No scheduler or paid AI call is involved.

The browser calls `apply_contact_topic_command(request UUID, command)` using the signed-in owner. MCP calls `apply_contact_topic_command_for_user(owner UUID, request UUID, command)` through its service client, after contacts scope and AI visibility checks. Both enter the same database implementation. Business conflicts use SQLSTATE `PT409` (HTTP 409), avoiding automatic serialization retries by hosted PostgREST. A request UUID identifies one intent; transport retries keep its exact payload. Version conflicts require rereading before a new command.

Priority is High, Normal, Low, with oldest creation first within each level. A one-off discussion completes a topic. A recurring discussion keeps it active unless `close_after` is true. Archive means no more discussion is wanted; it does not fabricate a conversation. Reopen retains history. Undo appends a reversal and can only reverse the latest eligible mutation. Discussion snapshots retain original wording after title edits.

## Storage and lifecycle

`contact_topics` stores the current state. `contact_topic_events` stores immutable command receipts and snapshots, including discussions, reversals, and person transfers. Owner/person and owner/topic composite foreign keys enforce matching ownership. Browser table writes are revoked; authenticated reads use row ownership policies.

Person merges transfer topic IDs and all history in the same transaction as the person's merge marker. Transfer increments versions so an older edit or undo cannot reverse a transfer. Merging into the user's own profile requires assigning topics to another owned person first. A self-merge reserves the visible source before moving profile data. On interruption the reservation remains and retry resumes it; only success clears it. Shared command locks and an exclusive contact-lifecycle lock prevent topic capture from racing a merge or deletion. Explicit person deletion cascades through topics and events; archive is the ordinary topic removal operation.

The GitHub people mirror does **not** back up native topics or history. Its existing `people-vault.ts`, `people-sync-core.ts`, and `github-people-sync` paths serialize profile facts and person metadata, not these tables. Do not import or export topics as editable note checkboxes. Database backups must include both feature tables.

## Release preparation

Production migration and publication require Michael's approval. A feature-branch push does not deploy the database, functions, or frontend.

After approval:

1. Verify the feature commit, migration inventory, database backup, and existing function/frontend versions. Apply `supabase/migrations/20260907140000_contact_topics.sql`, then `supabase/migrations/20260907141000_contact_topic_conflict_http.sql` to project `tjeapelvjlmbxafsmjef` in a transaction. Record the migration in the project's migration history. Do not bulk-push unrelated pending migrations.
2. Verify grants, ownership policies, command functions, composite keys, merge trigger, and `supabase_realtime` publication membership. Run a synthetic release check under two test owners.
3. Deploy `menerio-mcp` and `merge-contacts` together: `npx supabase@latest functions deploy menerio-mcp merge-contacts --project-ref tjeapelvjlmbxafsmjef --use-api`. Verify `verify_jwt=false` for the MCP endpoint remains applied; its own key authentication and data scopes remain mandatory. Preserve the existing merge function authentication configuration.
4. Merge the reviewed feature branch into `main`, let Lovable sync the build, and publish that tested frontend through the existing Menerio Lovable project. A successful local build or GitHub push is not evidence of public publication.
5. Refresh shared hub skill discovery after the MCP tool list contains all eight topic tools. The skill already handles unavailable tools without claiming a save or creating substitute notes.
6. With synthetic test people, verify browser create to MCP list, MCP create to an already-open mobile profile, discussion/history in both directions, recurring close-after, and isolation. Archive the test topics through the feature.

Rollback restores the previous frontend and MCP/merge function builds and disables topic use in the hub. Keep the additive tables, receipts, and history; never drop them as rollback. Restore service before attempting a corrective migration.

Provider references checked during preparation: [Supabase function CLI](https://supabase.com/docs/reference/cli/supabase-functions-deploy), [database migrations](https://supabase.com/docs/guides/deployment/database-migrations), [Lovable GitHub sync](https://docs.lovable.dev/integrations/github), and [Lovable publishing](https://docs.lovable.dev/features/publish).

## Verification record

See [the tested result and UI evidence](CONTACT_TOPICS_VERIFICATION.md) and [reproduction instructions](CONTACT_TOPICS_TESTING.md). The local database uses synthetic fixtures only. Local SDK/HTTP and browser checks do not substitute for the post-release smoke check above.
