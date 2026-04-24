## Plan: make GitHub sync create the repository when missing

### What is happening now

The current GitHub sync code assumes the repository already exists:

- The settings page saves `repo_owner`, `repo_name`, token, branch, and vault path directly into `github_connections`.
- `Test Connection` calls `GET /repos/{owner}/{repo}` from the browser. If the repo does not exist, it only reports an error.
- `Export All Notes` calls `github-sync-export`, which tries to read/write files in the configured repo.
- `Sync Now` calls `github-sync-pull`, which first tries to fetch the repo tree via `GET /repos/{owner}/{repo}/git/trees/{branch}?recursive=1`.
- If the repo does not exist, those GitHub calls fail with 404. In `github-sync-pull`, that means the sync can fail before pushing notes.

This explains the confusing state you saw: `last_sync_at` can be updated by sync code/scheduled sync UI paths even when the target repository was never actually created. So the settings can appear recently synced while GitHub still has no repository.

### User-facing behavior to add

1. When a user provides a valid token, owner, and repository name, Menerio should automatically ensure the repository exists before writing or syncing.
2. If the repository is missing and the owner is the authenticated GitHub user, Menerio should create it automatically.
3. If the repository is missing and the owner is an organization, Menerio should try to create it under that org.
4. If GitHub rejects creation because the token lacks permission, Menerio should show a clear error explaining what permission/scope is missing.
5. `Last sync` should only reflect a real successful sync/export, not a misleading no-op.

### Implementation steps

1. Add repository bootstrap helpers to the GitHub Edge Functions
   - Add `githubGetAuthenticatedUser(token)`.
   - Add `githubGetRepo(token, owner, repo)`.
   - Add `githubCreateUserRepo(token, repoName)` using `POST /user/repos`.
   - Add `githubCreateOrgRepo(token, org, repoName)` using `POST /orgs/{org}/repos`.
   - Add `ensureGithubRepository(token, owner, repo, branch)` that:
     - returns immediately if the repo exists,
     - creates it if GitHub returns 404,
     - verifies/returns a helpful error for 401/403/422,
     - treats initial default branch creation correctly.

2. Use the helper before export writes
   - In `supabase/functions/github-sync-export/index.ts`, call `ensureGithubRepository(...)` before bulk export and before single-note export/delete.
   - This guarantees `Export All Notes` can create the configured repo, then write Markdown files.

3. Use the helper before bidirectional sync/pull
   - In `supabase/functions/github-sync-pull/index.ts`, call `ensureGithubRepository(...)` before fetching the Git tree.
   - For a newly created empty repo, handle the empty-tree case gracefully and continue to the “push pending local notes” step, instead of failing before it can write anything.

4. Fix misleading sync status
   - Make `github-sync-pull` count push failures instead of silently swallowing them.
   - Only update `github_connections.last_sync_at` after a successful sync attempt that actually completed the GitHub operations.
   - Return useful response fields such as `repository_created`, `pushed`, `errors`, and per-note failure details.

5. Improve Settings UX
   - Update `Test Connection` behavior so a missing repo is not just a failure. It should say something like: “Repository does not exist yet. It will be created on first export/sync.”
   - Optionally add a small note under the repo fields: “If this repository does not exist, Menerio will create it when syncing, provided your token has permission.”
   - Improve the `Export All Notes` error toast to surface the backend error message when repository creation fails.

6. Validate with real behavior, not just unit assumptions
   - Test the helper paths against GitHub API semantics in code-level checks/mocks where possible.
   - Verify the app no longer reports successful sync if GitHub write/create fails.
   - After implementation, the expected manual verification is:
     - enter a repo name that does not exist,
     - click `Export All Notes`,
     - confirm the repository exists on GitHub,
     - confirm Markdown files are present,
     - confirm `last_sync_at` updates only after that successful export.

### Technical notes

- Repository creation requires a token with sufficient permissions:
  - classic PAT: `repo` scope for private repos, or `public_repo` for public-only behavior,
  - fine-grained PAT: repository administration/content permissions sufficient to create repositories and write contents.
- For organization repos, GitHub also requires the token owner to have permission to create repos in that organization.
- I will keep this in the existing GitHub sync Edge Functions rather than adding a database migration, because the current schema already stores the needed repo settings.
- I will not change the note editor/content conversion as part of this fix; this is scoped to GitHub repository creation and reliable sync status.