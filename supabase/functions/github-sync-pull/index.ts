import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ─── Markdown → HTML (same as import-vault) ──────────────────────────

function markdownToHtml(md: string): string {
  if (!md) return "";
  let html = md;

  const codeBlocks: string[] = [];
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const idx = codeBlocks.length;
    const langAttr = lang ? ` class="language-${lang}"` : "";
    codeBlocks.push(`<pre><code${langAttr}>${encodeEntities(code.trimEnd())}</code></pre>`);
    return `%%CODEBLOCK_${idx}%%`;
  });

  const inlineCodes: string[] = [];
  html = html.replace(/`([^`]+)`/g, (_, code) => {
    const idx = inlineCodes.length;
    inlineCodes.push(`<code>${encodeEntities(code)}</code>`);
    return `%%INLINECODE_${idx}%%`;
  });

  const blocks = html.split(/\n{2,}/);
  const processedBlocks: string[] = [];

  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;

    if (trimmed.match(/^%%CODEBLOCK_\d+%%$/)) {
      processedBlocks.push(codeBlocks[parseInt(trimmed.match(/\d+/)![0])]);
      continue;
    }
    if (/^(-{3,}|_{3,}|\*{3,})$/.test(trimmed)) { processedBlocks.push("<hr>"); continue; }

    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      processedBlocks.push(`<h${headingMatch[1].length}>${inlineMarkdown(headingMatch[2])}</h${headingMatch[1].length}>`);
      continue;
    }

    if (trimmed.startsWith(">")) {
      const inner = trimmed.split("\n").map((l) => l.replace(/^>\s?/, "")).join("\n");
      processedBlocks.push(`<blockquote>${markdownToHtml(inner)}</blockquote>`);
      continue;
    }

    if (/^- \[[ x]\]/m.test(trimmed)) {
      const items = trimmed.split("\n").filter((l) => l.trim());
      let listHtml = '<ul data-type="taskList">';
      for (const item of items) {
        const m = item.match(/^- \[([ x])\]\s*(.*)/);
        if (m) {
          const checked = m[1] === "x" ? "true" : "false";
          listHtml += `<li data-type="taskItem" data-checked="${checked}"><label><input type="checkbox"${checked === "true" ? " checked" : ""}><span></span></label><div><p>${inlineMarkdown(m[2])}</p></div></li>`;
        }
      }
      processedBlocks.push(listHtml + "</ul>");
      continue;
    }

    if (/^[-*+]\s/.test(trimmed)) {
      const items = trimmed.split("\n").filter((l) => l.trim());
      let listHtml = "<ul>";
      for (const item of items) {
        const m = item.match(/^[-*+]\s+(.*)/);
        if (m) listHtml += `<li><p>${inlineMarkdown(m[1])}</p></li>`;
      }
      processedBlocks.push(listHtml + "</ul>");
      continue;
    }

    if (/^\d+\.\s/.test(trimmed)) {
      const items = trimmed.split("\n").filter((l) => l.trim());
      let listHtml = "<ol>";
      for (const item of items) {
        const m = item.match(/^\d+\.\s+(.*)/);
        if (m) listHtml += `<li><p>${inlineMarkdown(m[1])}</p></li>`;
      }
      processedBlocks.push(listHtml + "</ol>");
      continue;
    }

    const lines = trimmed.split("\n");
    processedBlocks.push(`<p>${lines.map((l) => inlineMarkdown(l)).join("<br>")}</p>`);
  }

  let result = processedBlocks.join("");
  for (let i = 0; i < inlineCodes.length; i++) {
    result = result.replace(`%%INLINECODE_${i}%%`, inlineCodes[i]);
  }
  return result;
}

function inlineMarkdown(text: string): string {
  let r = text;
  r = r.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1">');
  r = r.replace(/!\[\[([^\]]+)\]\]/g, '<img src="$1" alt="$1">');
  r = r.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  r = r.replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>");
  r = r.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  r = r.replace(/\*(.+?)\*/g, "<em>$1</em>");
  r = r.replace(/~~(.+?)~~/g, "<del>$1</del>");
  r = r.replace(/==(.+?)==/g, "<mark>$1</mark>");
  return r;
}

function encodeEntities(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function parseFrontmatter(content: string): { data: Record<string, unknown>; body: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return { data: {}, body: content };
  const data: Record<string, unknown> = {};
  for (const line of match[1].split("\n")) {
    const kv = line.match(/^(\w[\w_]*)\s*:\s*(.*)$/);
    if (!kv) continue;
    let val: unknown = kv[2].trim();
    if (typeof val === "string" && val.startsWith("[") && val.endsWith("]")) {
      val = val.slice(1, -1).split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
    } else if (val === "true") val = true;
    else if (val === "false") val = false;
    else if (typeof val === "string" && val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    data[kv[1]] = val;
  }
  return { data, body: match[2] };
}

function filePathToNoteTitle(filePath: string): string {
  return (filePath.split("/").pop() || filePath).replace(/\.md$/i, "");
}

// ─── Main handler ────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsErr } = await userClient.auth.getClaims(token);
    if (claimsErr || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }
    const userId = claimsData.claims.sub as string;

    const body = await req.json().catch(() => ({}));

    // Get GitHub connection
    const { data: ghConn } = await serviceClient
      .from("github_connections")
      .select("*")
      .eq("user_id", userId)
      .single();

    if (!ghConn || !ghConn.repo_owner || !ghConn.repo_name) {
      return new Response(JSON.stringify({ error: "No GitHub connection configured" }), { status: 400, headers: corsHeaders });
    }

    const ghToken = ghConn.github_token;
    const owner = ghConn.repo_owner;
    const repo = ghConn.repo_name;
    const branch = ghConn.branch || "main";
    const vaultPath = ghConn.vault_path || "/";
    const lastSyncAt = ghConn.last_sync_at;

    // ── Action: resolve-conflict ──
    if (body.action === "resolve-conflict") {
      return await resolveConflict(serviceClient, userId, ghToken, owner, repo, branch, vaultPath, body);
    }

    // ── Action: get-conflicts ──
    if (body.action === "get-conflicts") {
      const { data: conflicts } = await serviceClient
        .from("github_sync_log")
        .select("*, notes!inner(id, title, content, updated_at)")
        .eq("user_id", userId)
        .eq("sync_status", "conflict");

      return new Response(JSON.stringify({ conflicts: conflicts || [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Default action: pull remote changes ──
    const basePath = vaultPath === "/" ? "" : vaultPath.replace(/^\/|\/$/g, "");

    // 1. Get all current sync log entries
    const { data: syncEntries } = await serviceClient
      .from("github_sync_log")
      .select("*")
      .eq("user_id", userId);

    const syncByPath = new Map<string, any>();
    const syncByNoteId = new Map<string, any>();
    for (const e of syncEntries || []) {
      syncByPath.set(e.github_path, e);
      syncByNoteId.set(e.note_id, e);
    }

    // 2. Get the current tree from GitHub
    const treeRes = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`,
      { headers: { Authorization: `token ${ghToken}`, Accept: "application/vnd.github.v3+json" } }
    );
    if (!treeRes.ok) throw new Error(`Failed to fetch tree: ${treeRes.status}`);
    const treeData = await treeRes.json();

    const remoteFiles = (treeData.tree || []).filter((item: any) => {
      if (item.type !== "blob" || !item.path.endsWith(".md")) return false;
      if (item.path.includes("/.") || item.path.startsWith(".") || item.path.includes(".obsidian/")) return false;
      if (basePath && !item.path.startsWith(basePath + "/") && item.path !== basePath) return false;
      return true;
    });

    const remoteByPath = new Map<string, any>();
    for (const f of remoteFiles) remoteByPath.set(f.path, f);

    const results = { pulled: 0, conflicts: 0, new_imports: 0, deleted_remote: 0, errors: 0, details: [] as any[] };

    // 3. Check each tracked file for changes
    for (const [path, syncEntry] of syncByPath) {
      const remoteFile = remoteByPath.get(path);

      if (!remoteFile) {
        // File deleted from GitHub
        await serviceClient
          .from("github_sync_log")
          .update({ sync_status: "remote_deleted" })
          .eq("id", syncEntry.id);
        results.deleted_remote++;
        results.details.push({ path, action: "remote_deleted" });
        continue;
      }

      // Compare SHA — if same, no remote changes
      if (remoteFile.sha === syncEntry.github_sha) continue;

      // Remote changed — check if local also changed
      const { data: note } = await serviceClient
        .from("notes")
        .select("id, title, content, updated_at")
        .eq("id", syncEntry.note_id)
        .single();

      if (!note) continue;

      const localChangedSinceSync = syncEntry.synced_at && new Date(note.updated_at) > new Date(syncEntry.synced_at);

      if (localChangedSinceSync) {
        // CONFLICT
        await serviceClient
          .from("github_sync_log")
          .update({
            sync_status: "conflict",
            github_sha: remoteFile.sha,
            error_message: "Both local and remote were modified since last sync",
          })
          .eq("id", syncEntry.id);
        results.conflicts++;
        results.details.push({ path, action: "conflict", noteId: note.id });
      } else {
        // Safe to import remote
        try {
          const content = await githubGetFileContent(ghToken, owner, repo, path, branch);
          if (!content) { results.errors++; continue; }

          const { data: fm, body: mdBody } = parseFrontmatter(content);
          const htmlContent = markdownToHtml(mdBody);

          let metadata: Record<string, unknown> = {};
          if (fm.menerio_metadata && typeof fm.menerio_metadata === "string") {
            try { metadata = JSON.parse(atob(fm.menerio_metadata as string)); } catch { /* ignore */ }
          }

          const tags: string[] = [];
          if (Array.isArray(fm.tags)) tags.push(...(fm.tags as string[]));
          else if (typeof fm.tags === "string") tags.push(fm.tags);

          await serviceClient.from("notes").update({
            title: (fm.title as string) || note.title,
            content: htmlContent,
            metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
            tags: tags.length > 0 ? [...new Set(tags)] : undefined,
          }).eq("id", note.id);

          await serviceClient.from("github_sync_log").update({
            github_sha: remoteFile.sha,
            sync_status: "synced",
            synced_at: new Date().toISOString(),
            error_message: null,
          }).eq("id", syncEntry.id);

          results.pulled++;
          results.details.push({ path, action: "pulled", noteId: note.id });
        } catch (err) {
          results.errors++;
          results.details.push({ path, action: "error", error: String(err) });
        }
      }
    }

    // 4. Check for new files in remote (not in sync log)
    for (const [path, remoteFile] of remoteByPath) {
      if (syncByPath.has(path)) continue;

      try {
        const content = await githubGetFileContent(ghToken, owner, repo, path, branch);
        if (!content) { results.errors++; continue; }

        const { data: fm, body: mdBody } = parseFrontmatter(content);
        const title = (fm.title as string) || filePathToNoteTitle(path);
        const htmlContent = markdownToHtml(mdBody);

        let metadata: Record<string, unknown> = {};
        if (fm.menerio_metadata && typeof fm.menerio_metadata === "string") {
          try { metadata = JSON.parse(atob(fm.menerio_metadata as string)); } catch { /* ignore */ }
        }
        metadata.imported_from = "obsidian";
        metadata.original_path = path;

        const tags: string[] = [];
        if (Array.isArray(fm.tags)) tags.push(...(fm.tags as string[]));

        const { data: inserted, error: insertErr } = await serviceClient.from("notes").insert({
          user_id: userId,
          title,
          content: htmlContent,
          metadata,
          tags: [...new Set(tags)],
          source_app: "obsidian",
          entity_type: (fm.type as string) || null,
        }).select("id").single();

        if (insertErr) { results.errors++; continue; }

        await serviceClient.from("github_sync_log").upsert({
          user_id: userId,
          note_id: inserted.id,
          github_path: path,
          github_sha: remoteFile.sha,
          sync_status: "synced",
          sync_direction: "import",
          synced_at: new Date().toISOString(),
        }, { onConflict: "user_id,note_id" });

        results.new_imports++;
        results.details.push({ path, action: "new_import", noteId: inserted.id });
      } catch (err) {
        results.errors++;
        results.details.push({ path, action: "error", error: String(err) });
      }
    }

    // 5. Push pending local changes (notes updated since last sync)
    const { data: allNotes } = await serviceClient
      .from("notes")
      .select("id, title, content, metadata, tags, created_at, updated_at, is_favorite, is_pinned, entity_type, is_trashed")
      .eq("user_id", userId)
      .eq("is_trashed", false);

    let pushed = 0;
    for (const note of allNotes || []) {
      const syncEntry = syncByNoteId.get(note.id);
      if (syncEntry?.sync_status === "conflict") continue; // Don't push conflicted notes

      const needsPush = !syncEntry || (syncEntry.synced_at && new Date(note.updated_at) > new Date(syncEntry.synced_at));
      if (!needsPush) continue;

      try {
        const meta = (note.metadata || {}) as Record<string, unknown>;
        const fileName = (note.title || "Untitled").replace(/[<>:"/\\|?*]/g, "").replace(/\s+/g, " ").trim().slice(0, 200) || "Untitled";
        const subDir = meta.is_quick_capture ? "Inbox" : "";
        const base = vaultPath === "/" ? "" : vaultPath.replace(/^\/|\/$/g, "");
        const filePath = [base, subDir, `${fileName}.md`].filter(Boolean).join("/");

        // Check if path changed (rename)
        if (syncEntry && syncEntry.github_path !== filePath) {
          // Delete old file
          const oldFile = await githubGetFile(ghToken, owner, repo, syncEntry.github_path, branch);
          if (oldFile?.sha) {
            await githubDeleteFile(ghToken, owner, repo, syncEntry.github_path, oldFile.sha, `Rename: ${note.title}`, branch);
          }
        }

        // Build markdown content (reuse export logic)
        const frontmatterLines = ["---"];
        frontmatterLines.push(`id: ${note.id}`);
        frontmatterLines.push(`title: "${String(note.title || "").replace(/"/g, '\\"')}"`);
        frontmatterLines.push(`created: ${note.created_at}`);
        frontmatterLines.push(`modified: ${note.updated_at}`);
        const allTags = [...new Set([...(note.tags || []), ...(Array.isArray(meta.topics) ? meta.topics as string[] : [])])];
        if (allTags.length > 0) frontmatterLines.push(`tags: [${allTags.map((t: string) => `"${t}"`).join(", ")}]`);
        if (meta.type || note.entity_type) frontmatterLines.push(`type: ${meta.type || note.entity_type}`);
        if (Object.keys(meta).length > 0) frontmatterLines.push(`menerio_metadata: ${btoa(JSON.stringify(meta))}`);
        if (note.is_favorite) frontmatterLines.push("favorite: true");
        if (note.is_pinned) frontmatterLines.push("pinned: true");
        frontmatterLines.push("---");

        const mdBody = htmlToMarkdownServer(String(note.content || ""));
        const fullContent = frontmatterLines.join("\n") + "\n\n" + mdBody;

        const existing = await githubGetFile(ghToken, owner, repo, filePath, branch);
        const commitMsg = syncEntry ? `Update: ${note.title}` : `Create: ${note.title}`;
        const result = await githubPutFile(ghToken, owner, repo, filePath, fullContent, commitMsg, branch, existing?.sha);

        await serviceClient.from("github_sync_log").upsert({
          user_id: userId,
          note_id: note.id,
          github_path: filePath,
          github_sha: result.content?.sha || null,
          last_commit_sha: result.commit?.sha || null,
          sync_status: "synced",
          sync_direction: "export",
          synced_at: new Date().toISOString(),
          error_message: null,
        }, { onConflict: "user_id,note_id" });

        pushed++;
      } catch { /* skip push errors silently */ }
    }

    // Update last_sync_at
    await serviceClient
      .from("github_connections")
      .update({ last_sync_at: new Date().toISOString() })
      .eq("user_id", userId);

    return new Response(JSON.stringify({
      success: true,
      ...results,
      pushed,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("github-sync-pull error:", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: corsHeaders });
  }
});

// ─── Conflict resolution ─────────────────────────────────────────────

async function resolveConflict(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  ghToken: string,
  owner: string,
  repo: string,
  branch: string,
  vaultPath: string,
  body: any,
) {
  const { note_id, resolution } = body; // resolution: "keep_local" | "keep_remote" | "keep_both"

  const { data: syncEntry } = await supabase
    .from("github_sync_log")
    .select("*")
    .eq("user_id", userId)
    .eq("note_id", note_id)
    .single();

  if (!syncEntry) {
    return new Response(JSON.stringify({ error: "Sync entry not found" }), { status: 404, headers: corsHeaders });
  }

  const { data: note } = await supabase.from("notes").select("*").eq("id", note_id).single();
  if (!note) {
    return new Response(JSON.stringify({ error: "Note not found" }), { status: 404, headers: corsHeaders });
  }

  if (resolution === "keep_local") {
    // Push local to GitHub
    const meta = (note.metadata || {}) as Record<string, unknown>;
    const fileName = (note.title || "Untitled").replace(/[<>:"/\\|?*]/g, "").replace(/\s+/g, " ").trim().slice(0, 200) || "Untitled";
    const base = vaultPath === "/" ? "" : vaultPath.replace(/^\/|\/$/g, "");
    const filePath = [base, `${fileName}.md`].filter(Boolean).join("/");

    const frontmatterLines = ["---"];
    frontmatterLines.push(`id: ${note.id}`);
    frontmatterLines.push(`title: "${String(note.title || "").replace(/"/g, '\\"')}"`);
    frontmatterLines.push(`created: ${note.created_at}`);
    frontmatterLines.push(`modified: ${note.updated_at}`);
    if (Object.keys(meta).length > 0) frontmatterLines.push(`menerio_metadata: ${btoa(JSON.stringify(meta))}`);
    frontmatterLines.push("---");

    const mdBody = htmlToMarkdownServer(String(note.content || ""));
    const fullContent = frontmatterLines.join("\n") + "\n\n" + mdBody;

    const existing = await githubGetFile(ghToken, owner, repo, syncEntry.github_path, branch);
    const result = await githubPutFile(ghToken, owner, repo, syncEntry.github_path, fullContent, `Resolve conflict (keep local): ${note.title}`, branch, existing?.sha);

    await supabase.from("github_sync_log").update({
      github_sha: result.content?.sha || null,
      last_commit_sha: result.commit?.sha || null,
      sync_status: "synced",
      synced_at: new Date().toISOString(),
      error_message: null,
    }).eq("id", syncEntry.id);
  } else if (resolution === "keep_remote") {
    // Pull remote to Menerio
    const content = await githubGetFileContent(ghToken, owner, repo, syncEntry.github_path, branch);
    if (!content) {
      return new Response(JSON.stringify({ error: "Failed to fetch remote file" }), { status: 500, headers: corsHeaders });
    }

    const { data: fm, body: mdBody } = parseFrontmatter(content);
    const htmlContent = markdownToHtml(mdBody);

    let metadata: Record<string, unknown> = {};
    if (fm.menerio_metadata && typeof fm.menerio_metadata === "string") {
      try { metadata = JSON.parse(atob(fm.menerio_metadata as string)); } catch { /* ignore */ }
    }

    await supabase.from("notes").update({
      title: (fm.title as string) || note.title,
      content: htmlContent,
      metadata: Object.keys(metadata).length > 0 ? metadata : note.metadata,
    }).eq("id", note_id);

    const remoteFile = await githubGetFile(ghToken, owner, repo, syncEntry.github_path, branch);
    await supabase.from("github_sync_log").update({
      github_sha: remoteFile?.sha || syncEntry.github_sha,
      sync_status: "synced",
      synced_at: new Date().toISOString(),
      error_message: null,
    }).eq("id", syncEntry.id);
  } else if (resolution === "keep_both") {
    // Import remote as a new note with suffix
    const content = await githubGetFileContent(ghToken, owner, repo, syncEntry.github_path, branch);
    if (!content) {
      return new Response(JSON.stringify({ error: "Failed to fetch remote file" }), { status: 500, headers: corsHeaders });
    }

    const { data: fm, body: mdBody } = parseFrontmatter(content);
    const htmlContent = markdownToHtml(mdBody);

    const newTitle = `${note.title} (conflict copy)`;
    await supabase.from("notes").insert({
      user_id: userId,
      title: newTitle,
      content: htmlContent,
      metadata: note.metadata,
      tags: note.tags,
      source_app: "obsidian",
    });

    // Mark original as resolved — push local version
    const meta = (note.metadata || {}) as Record<string, unknown>;
    const existing = await githubGetFile(ghToken, owner, repo, syncEntry.github_path, branch);
    const frontmatterLines = ["---", `id: ${note.id}`, `title: "${note.title}"`, "---"];
    const mdBody2 = htmlToMarkdownServer(String(note.content || ""));
    const result = await githubPutFile(ghToken, owner, repo, syncEntry.github_path, frontmatterLines.join("\n") + "\n\n" + mdBody2, `Resolve conflict (keep both): ${note.title}`, branch, existing?.sha);

    await supabase.from("github_sync_log").update({
      github_sha: result.content?.sha || null,
      sync_status: "synced",
      synced_at: new Date().toISOString(),
      error_message: null,
    }).eq("id", syncEntry.id);
  }

  return new Response(JSON.stringify({ success: true, resolution }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ─── HTML → Markdown (server-side) ───────────────────────────────────

function htmlToMarkdownServer(html: string): string {
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
    const inner = htmlToMarkdownServer(c).trim();
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

// ─── GitHub API helpers ──────────────────────────────────────────────

async function githubGetFile(token: string, owner: string, repo: string, path: string, ref: string) {
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=${ref}`, {
    headers: { Authorization: `token ${token}`, Accept: "application/vnd.github.v3+json" },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub GET file failed: ${res.status}`);
  return await res.json();
}

async function githubGetFileContent(token: string, owner: string, repo: string, path: string, ref: string): Promise<string | null> {
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=${ref}`, {
    headers: { Authorization: `token ${token}`, Accept: "application/vnd.github.v3+json" },
  });
  if (!res.ok) return null;
  const data = await res.json();
  if (!data.content) return null;
  return decodeURIComponent(escape(atob(data.content.replace(/\n/g, ""))));
}

async function githubPutFile(token: string, owner: string, repo: string, path: string, content: string, message: string, branch: string, sha?: string) {
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
  if (!res.ok) throw new Error(`GitHub PUT failed: ${res.status} ${await res.text()}`);
  return await res.json();
}

async function githubDeleteFile(token: string, owner: string, repo: string, path: string, sha: string, message: string, branch: string) {
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`, {
    method: "DELETE",
    headers: { Authorization: `token ${token}`, Accept: "application/vnd.github.v3+json", "Content-Type": "application/json" },
    body: JSON.stringify({ message, sha, branch }),
  });
  if (!res.ok) throw new Error(`GitHub DELETE failed: ${res.status}`);
  return await res.json();
}
