// GitHub REST helpers shared by the github-* sync functions.
// Extracted verbatim from github-sync-pull; keep behavior identical.

export async function ensureGithubRepository(token: string, owner: string, repo: string, branch: string) {
  const existing = await githubGetRepo(token, owner, repo);
  if (existing) return { created: false, repository: existing };

  const user = await githubGetAuthenticatedUser(token);
  const created = user.login?.toLowerCase() === owner.toLowerCase()
    ? await githubCreateUserRepo(token, repo, branch)
    : await githubCreateOrgRepo(token, owner, repo, branch);

  return { created: true, repository: created };
}

export async function githubGetAuthenticatedUser(token: string) {
  const res = await fetch("https://api.github.com/user", {
    headers: { Authorization: `token ${token}`, Accept: "application/vnd.github.v3+json" },
  });
  if (!res.ok) throw new Error(`GitHub authentication failed (${res.status}): ${await res.text()}`);
  return await res.json();
}

export async function githubGetRepo(token: string, owner: string, repo: string) {
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
    headers: { Authorization: `token ${token}`, Accept: "application/vnd.github.v3+json" },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub repository check failed (${res.status}): ${await res.text()}`);
  return await res.json();
}

export async function githubCreateUserRepo(token: string, repo: string, branch: string) {
  const res = await fetch("https://api.github.com/user/repos", {
    method: "POST",
    headers: { Authorization: `token ${token}`, Accept: "application/vnd.github.v3+json", "Content-Type": "application/json" },
    body: JSON.stringify({ name: repo, private: true, auto_init: true, default_branch: branch || "main" }),
  });
  if (!res.ok) throw new Error(`GitHub repository creation failed (${res.status}): ${await res.text()}`);
  return await res.json();
}

export async function githubCreateOrgRepo(token: string, org: string, repo: string, branch: string) {
  const res = await fetch(`https://api.github.com/orgs/${org}/repos`, {
    method: "POST",
    headers: { Authorization: `token ${token}`, Accept: "application/vnd.github.v3+json", "Content-Type": "application/json" },
    body: JSON.stringify({ name: repo, private: true, auto_init: true, default_branch: branch || "main" }),
  });
  if (!res.ok) throw new Error(`GitHub organization repository creation failed (${res.status}): ${await res.text()}`);
  return await res.json();
}

export async function githubGetFile(token: string, owner: string, repo: string, path: string, ref: string) {
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=${ref}`, {
    headers: { Authorization: `token ${token}`, Accept: "application/vnd.github.v3+json" },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub GET file failed: ${res.status}`);
  return await res.json();
}

export async function githubGetFileContent(token: string, owner: string, repo: string, path: string, ref: string): Promise<string | null> {
  const file = await githubGetFile(token, owner, repo, path, ref).catch(() => null);
  if (!file?.content) return null;
  return decodeURIComponent(escape(atob(file.content.replace(/\n/g, ""))));
}

export async function githubPutFile(
  token: string, owner: string, repo: string, path: string,
  content: string, message: string, branch: string, sha?: string,
) {
  const body: Record<string, unknown> = {
    message,
    content: btoa(unescape(encodeURIComponent(content))),
    branch,
  };
  if (sha) body.sha = sha;
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`, {
    method: "PUT",
    headers: { Authorization: `token ${token}`, Accept: "application/vnd.github.v3+json", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`GitHub PUT failed (${res.status}): ${await res.text()}`);
  return await res.json();
}

export async function githubDeleteFile(
  token: string, owner: string, repo: string, path: string,
  sha: string, message: string, branch: string,
) {
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`, {
    method: "DELETE",
    headers: { Authorization: `token ${token}`, Accept: "application/vnd.github.v3+json", "Content-Type": "application/json" },
    body: JSON.stringify({ message, sha, branch }),
  });
  if (!res.ok) throw new Error(`GitHub DELETE failed (${res.status}): ${await res.text()}`);
  return await res.json();
}
