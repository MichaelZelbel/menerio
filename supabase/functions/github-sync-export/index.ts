import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

type DbClient = any;
type SyncResult = Record<string, unknown> & { success: boolean; error?: string; path?: string };

/** Returns true when content looks like HTML (has block-level tags) */
function looksLikeHtml(content: string): boolean {
  return /<(?:p|h[1-6]|ul|ol|li|blockquote|pre|img|table)\b/i.test(content);
}

/** Convert Tiptap HTML to Markdown (server-side, no DOM). */
function htmlToMarkdown(html: string): string {
  if (!html || !html.trim()) return "";
  let md = html;
  md = md.replace(/<br\s*\/?>/gi, "  \n");
  md = md.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, (_, c) => `# ${strip(c)}\n\n`);
  md = md.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (_, c) => `## ${strip(c)}\n\n`);
  md = md.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, (_, c) => `### ${strip(c)}\n\n`);
  md = md.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, (_, c) => `#### ${strip(c)}\n\n`);
  md = md.replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, (_, c) => `##### ${strip(c)}\n\n`);
  md = md.replace(/<h6[^>]*>([\s\S]*?)<\/h6>/gi, (_, c) => `###### ${strip(c)}\n\n`);
  md = md.replace(/<hr\s*\/?>/gi, "\n---\n\n");
  md = md.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, c) => {
    const inner = htmlToMarkdown(c).trim();
    return inner.split("\n").map((l: string) => `> ${l}`).join("\n") + "\n\n";
  });
  md = md.replace(/<pre[^>]*><code(?:\s+class="language-(\w+)")?[^>]*>([\s\S]*?)<\/code><\/pre>/gi, (_, lang, code) =>
    `\`\`\`${lang || ""}\n${decode(code).trimEnd()}\n\`\`\`\n\n`
  );
  md = md.replace(/<ul[^>]*data-type="taskList"[^>]*>([\s\S]*?)<\/ul>/gi, (_, items) =>
    items.replace(/<li[^>]*data-checked="(true|false)"[^>]*>([\s\S]*?)<\/li>/gi, (_m: string, checked: string, text: string) =>
      `- ${checked === "true" ? "[x]" : "[ ]"} ${strip(text).trim()}\n`
    ) + "\n"
  );
  md = md.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, (_, items) =>
    items.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_m: string, text: string) => `- ${strip(text).trim()}\n`) + "\n"
  );
  md = md.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (_, items) => {
    let idx = 0;
    return items.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_m: string, text: string) => {
      idx++;
      return `${idx}. ${strip(text).trim()}\n`;
    }) + "\n";
  });
  md = md.replace(/<img[^>]*src="([^"]*)"[^>]*alt="([^"]*)"[^>]*\/?>/gi, (_, src, alt) => `![${alt}](${src})`);
  md = md.replace(/<img[^>]*src="([^"]*)"[^>]*\/?>/gi, (_, src) => `![](${src})`);
  md = md.replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href, text) => `[${strip(text)}](${href})`);
  md = md.replace(/<(?:strong|b)>([\s\S]*?)<\/(?:strong|b)>/gi, (_, c) => `**${c}**`);
  md = md.replace(/<(?:em|i)>([\s\S]*?)<\/(?:em|i)>/gi, (_, c) => `*${c}*`);
  md = md.replace(/<(?:del|s|strike)>([\s\S]*?)<\/(?:del|s|strike)>/gi, (_, c) => `~~${c}~~`);
  md = md.replace(/<code>([\s\S]*?)<\/code>/gi, (_, c) => `\`${decode(c)}\``);
  md = md.replace(/<mark[^>]*>([\s\S]*?)<\/mark>/gi, (_, c) => `==${c}==`);
  md = md.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (_, c) => `${strip(c)}\n\n`);
  md = md.replace(/<[^>]+>/g, "");
  md = decode(md);
  md = md.replace(/\n{3,}/g, "\n\n");
  return md.trim() + "\n";
}

function strip(html: string): string {
  return html.replace(/<\/?(?:p|div|label|span)[^>]*>/gi, "").trim();
}

function decode(text: string): string {
  return text.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ");
}

function sanitizeFileName(name: string): string {
  return name.replace(/[<>:"/\\|?*]/g, "").replace(/\s+/g, " ").trim().slice(0, 200) || "Untitled";
}

function normalizePathPart(path: unknown): string {
  return String(path || "").replace(/^\/+|\/+$/g, "").replace(/\/+/g, "/").trim();
}

function buildNotePath(vaultPath: string, note: Record<string, unknown>, fileName?: string): string {
  const base = normalizePathPart(vaultPath);
  const folder = normalizePathPart(note.folder_path);
  const name = sanitizeFileName(fileName || String(note.title || "Untitled"));
  return [base, folder, `${name}.md`].filter(Boolean).join("/");
}

function incrementPath(path: string, index: number): string {
  return path.replace(/\.md$/i, ` ${index}.md`);
}

// ─── Attachment helpers ──────────────────────────────────────────────

const SIGNED_URL_RE = /\/storage\/v1\/object\/(?:sign|public)\/note-attachments\/([^?")\s]+)/g;

/** Extract wikilink filenames `![[file.ext]]` and storage paths from signed URLs in markdown. */
function extractAttachmentRefs(md: string): { wikilinkNames: Set<string>; signedStoragePaths: Set<string> } {
  const wikilinkNames = new Set<string>();
  const signedStoragePaths = new Set<string>();

  for (const m of md.matchAll(/!\[\[([^\]\n|]+?)(?:\|[^\]\n]*)?\]\]/g)) {
    const name = m[1].trim().split("/").pop();
    if (name) wikilinkNames.add(name);
  }
  for (const m of md.matchAll(SIGNED_URL_RE)) {
    try {
      signedStoragePaths.add(decodeURIComponent(m[1]));
    } catch {
      signedStoragePaths.add(m[1]);
    }
  }
  return { wikilinkNames, signedStoragePaths };
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

/**
 * Sync attachments referenced by a note's markdown into the GitHub repo.
 * - Resolves wikilink filenames via `note_attachments` lookup.
 * - For legacy signed-URL refs: ensures a `note_attachments` row exists, then rewrites the URL to `![[filename]]`.
 * - Returns the (possibly rewritten) markdown.
 */
async function syncAttachmentsForNote(
  supabase: DbClient,
  userId: string,
  ghToken: string,
  owner: string,
  repo: string,
  branch: string,
  vaultPath: string,
  attachmentFolder: string,
  markdown: string,
): Promise<string> {
  let body = markdown;
  const { wikilinkNames, signedStoragePaths } = extractAttachmentRefs(body);

  // 1. Resolve legacy signed URLs → ensure note_attachments row, rewrite to wikilink
  if (signedStoragePaths.size > 0) {
    const paths = Array.from(signedStoragePaths);
    const { data: existingByPath } = await supabase
      .from("note_attachments")
      .select("filename, storage_path")
      .eq("user_id", userId)
      .in("storage_path", paths);
    const pathToFilename = new Map<string, string>();
    for (const row of existingByPath || []) {
      pathToFilename.set(row.storage_path, row.filename);
    }

    // Create rows for unknown storage paths
    for (const p of paths) {
      if (pathToFilename.has(p)) continue;
      // Derive a readable filename from the storage path
      const last = p.split("/").pop() || "attachment";
      const ext = last.includes(".") ? last.slice(last.lastIndexOf(".")) : "";
      const baseName = `attachment-${last.slice(0, 8).replace(/[^a-zA-Z0-9]/g, "")}${ext}`;
      const filename = await resolveUniqueFilename(supabase, userId, baseName);
      const { error: insErr } = await supabase.from("note_attachments").insert({
        user_id: userId,
        filename,
        storage_path: p,
        source: "menerio",
      });
      if (!insErr) pathToFilename.set(p, filename);
    }

    // Rewrite markdown: replace signed URLs with `![[filename]]`
    body = body.replace(
      /!\[[^\]]*\]\(([^)]*\/storage\/v1\/object\/(?:sign|public)\/note-attachments\/[^)?\s]+)(?:\?[^)]*)?\)/g,
      (full, url) => {
        const m = url.match(/note-attachments\/([^?")\s]+)/);
        if (!m) return full;
        let path: string;
        try { path = decodeURIComponent(m[1]); } catch { path = m[1]; }
        const fn = pathToFilename.get(path);
        return fn ? `![[${fn}]]` : full;
      },
    );

    // Add newly-resolved filenames to the wikilink set so they get pushed below
    for (const fn of pathToFilename.values()) wikilinkNames.add(fn);
  }

  // 2. Push wikilink-referenced attachments to GitHub
  if (wikilinkNames.size === 0) return body;

  const folder = normalizePathPart(attachmentFolder || "attachments");
  const vaultBase = normalizePathPart(vaultPath);

  const { data: attachments } = await supabase
    .from("note_attachments")
    .select("*")
    .eq("user_id", userId)
    .in("filename", Array.from(wikilinkNames));

  for (const att of attachments || []) {
    try {
      // Skip if already synced and SHA unchanged
      const targetPath = att.github_path || [vaultBase, folder, att.filename].filter(Boolean).join("/");

      // Download from bucket
      const { data: blob, error: dlErr } = await supabase.storage
        .from("note-attachments")
        .download(att.storage_path);
      if (dlErr || !blob) {
        console.warn(`Skip attachment ${att.filename}: download failed`, dlErr);
        continue;
      }
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const localSha = att.sha256 || (await sha256Hex(bytes));

      // Check remote
      const remote = await githubGetFile(ghToken, owner, repo, targetPath, branch);
      if (remote && att.github_sha === remote.sha && att.sha256 === localSha) {
        continue; // up to date
      }

      const b64 = bytesToBase64(bytes);
      const putRes = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(targetPath)}`,
        {
          method: "PUT",
          headers: {
            Authorization: `token ${ghToken}`,
            Accept: "application/vnd.github.v3+json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            message: `Attachment: ${att.filename}`,
            content: b64,
            branch,
            ...(remote?.sha ? { sha: remote.sha } : {}),
          }),
        },
      );
      if (!putRes.ok) {
        console.warn(`Failed to push attachment ${att.filename}: ${putRes.status}`);
        continue;
      }
      const putJson = await putRes.json();
      await supabase
        .from("note_attachments")
        .update({
          github_path: targetPath,
          github_sha: putJson.content?.sha || null,
          github_synced_at: new Date().toISOString(),
          sha256: localSha,
          size_bytes: bytes.byteLength,
        })
        .eq("id", att.id);
    } catch (err) {
      console.warn(`Attachment sync error for ${att.filename}:`, err);
    }
  }

  return body;
}

async function resolveUniqueFilename(supabase: DbClient, userId: string, desired: string): Promise<string> {
  const dot = desired.lastIndexOf(".");
  const base = dot > 0 ? desired.slice(0, dot) : desired;
  const ext = dot > 0 ? desired.slice(dot) : "";
  for (let i = 0; i < 1000; i++) {
    const candidate = i === 0 ? desired : `${base}-${i + 1}${ext}`;
    const { data } = await supabase
      .from("note_attachments")
      .select("id")
      .eq("user_id", userId)
      .eq("filename", candidate)
      .maybeSingle();
    if (!data) return candidate;
  }
  return `${base}-${Date.now()}${ext}`;
}

function buildFrontmatter(note: Record<string, unknown>): string {
  const meta = (note.metadata || {}) as Record<string, unknown>;
  const lines: string[] = ["---"];
  lines.push(`id: ${note.id}`);
  lines.push(`title: "${String(note.title || "").replace(/"/g, '\\"')}"`);
  lines.push(`created: ${note.created_at}`);
  lines.push(`modified: ${note.updated_at}`);

  const topics = Array.isArray(meta.topics) ? meta.topics : [];
  const tags = Array.isArray(note.tags) ? note.tags : [];
  const allTags = [...new Set([...tags, ...topics])];
  if (allTags.length > 0) {
    lines.push(`tags: [${allTags.map((t: string) => `"${t}"`).join(", ")}]`);
  }
  if (meta.type || note.entity_type) lines.push(`type: ${meta.type || note.entity_type}`);
  if (Array.isArray(meta.people) && meta.people.length > 0) {
    lines.push(`people: [${(meta.people as string[]).map(p => `"${p}"`).join(", ")}]`);
  }
  if (Object.keys(meta).length > 0) {
    lines.push(`menerio_metadata: ${btoa(JSON.stringify(meta))}`);
  }
  if (note.is_favorite) lines.push("favorite: true");
  if (note.is_pinned) lines.push("pinned: true");
  lines.push("---");
  return lines.join("\n");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsErr } = await userClient.auth.getClaims(token);
    if (claimsErr || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }
    const userId = claimsData.claims.sub;

    const body = await req.json();
    const { note_id, action, bulk } = body;

    // Get GitHub connection
    const { data: ghConn, error: ghErr } = await serviceClient
      .from("github_connections")
      .select("*")
      .eq("user_id", userId)
      .single();

    if (ghErr || !ghConn) {
      return new Response(JSON.stringify({ error: "No GitHub connection found" }), { status: 400, headers: corsHeaders });
    }

    if (!ghConn.sync_enabled) {
      return new Response(JSON.stringify({ error: "Sync is disabled" }), { status: 400, headers: corsHeaders });
    }

    if (!ghConn.repo_owner || !ghConn.repo_name) {
      return new Response(JSON.stringify({ error: "Repository not configured" }), { status: 400, headers: corsHeaders });
    }

    const ghToken = ghConn.github_token;
    const owner = ghConn.repo_owner;
    const repo = ghConn.repo_name;
    const branch = ghConn.branch || "main";
    const vaultPath = ghConn.vault_path || "/";

    const shouldEnsureRepo = bulk || action !== "delete";
    const repoState = shouldEnsureRepo
      ? await ensureGithubRepository(ghToken, owner, repo, branch)
      : { created: false };

    // Handle bulk sync
    if (bulk) {
      return await handleBulkSync(serviceClient, userId, ghToken, owner, repo, branch, vaultPath, repoState.created);
    }

    if (!note_id || !action) {
      return new Response(JSON.stringify({ error: "note_id and action required" }), { status: 400, headers: corsHeaders });
    }

    // Get the note
    const { data: note, error: noteErr } = await serviceClient
      .from("notes")
      .select("*")
      .eq("id", note_id)
      .eq("user_id", userId)
      .single();

    if (noteErr || !note) {
      return new Response(JSON.stringify({ error: "Note not found" }), { status: 404, headers: corsHeaders });
    }

    const result = await syncSingleNote(serviceClient, userId, ghToken, owner, repo, branch, vaultPath, note, action);
    if (repoState.created) result.repository_created = true;
    return new Response(JSON.stringify(result), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("github-sync-export error:", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: corsHeaders });
  }
});

async function syncSingleNote(
  supabase: DbClient,
  userId: string,
  ghToken: string,
  owner: string,
  repo: string,
  branch: string,
  vaultPath: string,
  note: Record<string, unknown>,
  action: string
): Promise<SyncResult> {
  let filePath = buildNotePath(vaultPath, note);
  const { data: syncEntry } = await supabase
    .from("github_sync_log")
    .select("*")
    .eq("user_id", userId)
    .eq("note_id", note.id)
    .maybeSingle();

  try {
    if (action === "delete") {
      filePath = syncEntry?.github_path || filePath;
      // Get current file SHA
      const existing = await githubGetFile(ghToken, owner, repo, filePath, branch);
      if (existing?.sha) {
        await githubDeleteFile(ghToken, owner, repo, filePath, existing.sha, `Delete: ${note.title}`, branch);
      }
      // Remove sync log entry
      await supabase.from("github_sync_log").delete().eq("user_id", userId).eq("note_id", note.id);
      return { success: true, action: "deleted", path: filePath };
    }

    // Create/Update
    const frontmatter = buildFrontmatter(note);
    // Content is now stored as Markdown; only convert if legacy HTML detected
    const rawContent = String(note.content || "");
    const mdBody = looksLikeHtml(rawContent) ? htmlToMarkdown(rawContent) : rawContent;
    const fullContent = `${frontmatter}\n\n${mdBody}`;

    const desiredPath = buildNotePath(vaultPath, note);
    filePath = syncEntry?.github_path || desiredPath;
    if (!syncEntry || syncEntry.github_path !== desiredPath) {
      filePath = await resolveCollisionSafePath(supabase, userId, ghToken, owner, repo, branch, desiredPath, String(note.id));
      if (syncEntry?.github_path && syncEntry.github_path !== filePath) {
        const oldFile = await githubGetFile(ghToken, owner, repo, syncEntry.github_path, branch);
        if (oldFile?.sha) await githubDeleteFile(ghToken, owner, repo, syncEntry.github_path, oldFile.sha, `Rename: ${note.title}`, branch);
      }
    }

    // Check if file already exists (need SHA for updates)
    const existing = await githubGetFile(ghToken, owner, repo, filePath, branch);
    const commitMsg = action === "create" ? `Create: ${note.title}` : `Update: ${note.title}`;

    const result = await githubPutFile(ghToken, owner, repo, filePath, fullContent, commitMsg, branch, existing?.sha);

    // Upsert sync log
    await supabase.from("github_sync_log").upsert(
      {
        user_id: userId,
        note_id: note.id,
        github_path: filePath,
        github_sha: result.content?.sha || null,
        last_commit_sha: result.commit?.sha || null,
        sync_status: "synced",
        sync_direction: "export",
        error_message: null,
        synced_at: new Date().toISOString(),
      },
      { onConflict: "user_id,note_id" }
    );

    return { success: true, action, path: filePath, commit_sha: result.commit?.sha };
  } catch (err) {
    // Log the error
    await supabase.from("github_sync_log").upsert(
      {
        user_id: userId,
        note_id: note.id,
        github_path: filePath,
        sync_status: "error",
        sync_direction: "export",
        error_message: String(err),
        synced_at: new Date().toISOString(),
      },
      { onConflict: "user_id,note_id" }
    );
    return { success: false, error: String(err), path: filePath };
  }
}

async function resolveCollisionSafePath(
  supabase: DbClient,
  userId: string,
  ghToken: string,
  owner: string,
  repo: string,
  branch: string,
  desiredPath: string,
  noteId: string,
) {
  for (let i = 0; i < 100; i++) {
    const candidate = i === 0 ? desiredPath : incrementPath(desiredPath, i);
    const { data: pathOwner } = await supabase
      .from("github_sync_log")
      .select("note_id")
      .eq("user_id", userId)
      .eq("github_path", candidate)
      .neq("note_id", noteId)
      .maybeSingle();
    if (pathOwner) continue;
    const remoteFile = await githubGetFile(ghToken, owner, repo, candidate, branch);
    if (!remoteFile) return candidate;
    if (remoteFile) {
      const content = await githubGetFileContent(ghToken, owner, repo, candidate, branch).catch(() => "");
      if (content.includes(`id: ${noteId}`) || content.includes(`id: "${noteId}"`)) return candidate;
    }
  }
  throw new Error("Could not find a free GitHub path for note");
}

async function handleBulkSync(
  supabase: DbClient,
  userId: string,
  ghToken: string,
  owner: string,
  repo: string,
  branch: string,
  vaultPath: string,
  repositoryCreated = false,
) {
  // Get all non-trashed notes
  const { data: notes, error } = await supabase
    .from("notes")
    .select("*")
    .eq("user_id", userId)
    .eq("is_trashed", false)
    .order("updated_at", { ascending: false });

  if (error) {
    return new Response(JSON.stringify({ error: "Failed to fetch notes" }), { status: 500, headers: corsHeaders });
  }

  const results: { note_id: string; title: string; success: boolean; error?: string }[] = [];

  for (const note of (notes || [])) {
    const r = await syncSingleNote(supabase, userId, ghToken, owner, repo, branch, vaultPath, note, "update");
    results.push({ note_id: note.id, title: note.title, success: r.success, error: r.error });
  }

  const succeeded = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;

  if (failed === 0) {
    await supabase
      .from("github_connections")
      .update({ last_sync_at: new Date().toISOString() })
      .eq("user_id", userId);
  }

  return new Response(
    JSON.stringify({ success: failed === 0, total: results.length, succeeded, failed, repository_created: repositoryCreated, results }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

// ─── GitHub API helpers ──────────────────────────────────────────────

async function ensureGithubRepository(token: string, owner: string, repo: string, branch: string) {
  const existing = await githubGetRepo(token, owner, repo);
  if (existing) return { created: false, repository: existing };

  const user = await githubGetAuthenticatedUser(token);
  const created = user.login?.toLowerCase() === owner.toLowerCase()
    ? await githubCreateUserRepo(token, repo, branch)
    : await githubCreateOrgRepo(token, owner, repo, branch);

  return { created: true, repository: created };
}

async function githubGetAuthenticatedUser(token: string) {
  const res = await fetch("https://api.github.com/user", {
    headers: { Authorization: `token ${token}`, Accept: "application/vnd.github.v3+json" },
  });
  if (!res.ok) throw new Error(`GitHub authentication failed (${res.status}): ${await res.text()}`);
  return await res.json();
}

async function githubGetRepo(token: string, owner: string, repo: string) {
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
    headers: { Authorization: `token ${token}`, Accept: "application/vnd.github.v3+json" },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub repository check failed (${res.status}): ${await res.text()}`);
  return await res.json();
}

async function githubCreateUserRepo(token: string, repo: string, branch: string) {
  const res = await fetch("https://api.github.com/user/repos", {
    method: "POST",
    headers: { Authorization: `token ${token}`, Accept: "application/vnd.github.v3+json", "Content-Type": "application/json" },
    body: JSON.stringify({ name: repo, private: true, auto_init: true, default_branch: branch || "main" }),
  });
  if (!res.ok) throw new Error(`GitHub repository creation failed (${res.status}): ${await res.text()}`);
  return await res.json();
}

async function githubCreateOrgRepo(token: string, org: string, repo: string, branch: string) {
  const res = await fetch(`https://api.github.com/orgs/${org}/repos`, {
    method: "POST",
    headers: { Authorization: `token ${token}`, Accept: "application/vnd.github.v3+json", "Content-Type": "application/json" },
    body: JSON.stringify({ name: repo, private: true, auto_init: true, default_branch: branch || "main" }),
  });
  if (!res.ok) throw new Error(`GitHub organization repository creation failed (${res.status}): ${await res.text()}`);
  return await res.json();
}

async function githubGetFile(token: string, owner: string, repo: string, path: string, ref: string) {
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=${ref}`, {
    headers: { Authorization: `token ${token}`, Accept: "application/vnd.github.v3+json" },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub GET file failed: ${res.status}`);
  return await res.json();
}

async function githubGetFileContent(token: string, owner: string, repo: string, path: string, ref: string) {
  const file = await githubGetFile(token, owner, repo, path, ref);
  if (!file?.content) return "";
  return decodeURIComponent(escape(atob(file.content.replace(/\n/g, ""))));
}

async function githubPutFile(
  token: string, owner: string, repo: string, path: string,
  content: string, message: string, branch: string, sha?: string
) {
  const body: Record<string, unknown> = {
    message,
    content: btoa(unescape(encodeURIComponent(content))),
    branch,
  };
  if (sha) body.sha = sha;

  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`, {
    method: "PUT",
    headers: {
      Authorization: `token ${token}`,
      Accept: "application/vnd.github.v3+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`GitHub PUT failed (${res.status}): ${err}`);
  }
  return await res.json();
}

async function githubDeleteFile(
  token: string, owner: string, repo: string, path: string,
  sha: string, message: string, branch: string
) {
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`, {
    method: "DELETE",
    headers: {
      Authorization: `token ${token}`,
      Accept: "application/vnd.github.v3+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ message, sha, branch }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`GitHub DELETE failed (${res.status}): ${err}`);
  }
  return await res.json();
}
