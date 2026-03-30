import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ─── Markdown → HTML (server-side, same logic as export) ──────────────

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
      const idx = parseInt(trimmed.match(/\d+/)![0]);
      processedBlocks.push(codeBlocks[idx]);
      continue;
    }

    if (/^(-{3,}|_{3,}|\*{3,})$/.test(trimmed)) {
      processedBlocks.push("<hr>");
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      processedBlocks.push(`<h${level}>${inlineMarkdown(headingMatch[2])}</h${level}>`);
      continue;
    }

    if (trimmed.includes("|") && trimmed.includes("---")) {
      const rows = trimmed.split("\n").filter((r) => r.trim());
      if (rows.length >= 2) {
        const parseRow = (row: string) =>
          row.split("|").map((c) => c.trim()).filter((_, i, arr) => i > 0 && i < arr.length);
        const isSep = (row: string) => /^\|?\s*-{3,}/.test(row);
        let tableHtml = "<table><tbody>";
        let headerDone = false;
        for (const row of rows) {
          if (isSep(row)) { headerDone = true; continue; }
          const cells = parseRow(row);
          const tag = !headerDone ? "th" : "td";
          if (!headerDone) tableHtml = tableHtml.replace("<tbody>", "<thead>");
          tableHtml += "<tr>" + cells.map((c) => `<${tag}>${inlineMarkdown(c)}</${tag}>`).join("") + "</tr>";
          if (!headerDone) { tableHtml += "</thead><tbody>"; headerDone = true; }
        }
        tableHtml += "</tbody></table>";
        processedBlocks.push(tableHtml);
        continue;
      }
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
        const taskMatch = item.match(/^- \[([ x])\]\s*(.*)/);
        if (taskMatch) {
          const checked = taskMatch[1] === "x" ? "true" : "false";
          listHtml += `<li data-type="taskItem" data-checked="${checked}"><label><input type="checkbox"${checked === "true" ? " checked" : ""}><span></span></label><div><p>${inlineMarkdown(taskMatch[2])}</p></div></li>`;
        }
      }
      listHtml += "</ul>";
      processedBlocks.push(listHtml);
      continue;
    }

    if (/^[-*+]\s/.test(trimmed)) {
      const items = trimmed.split("\n").filter((l) => l.trim());
      let listHtml = "<ul>";
      for (const item of items) {
        const liMatch = item.match(/^[-*+]\s+(.*)/);
        if (liMatch) listHtml += `<li><p>${inlineMarkdown(liMatch[1])}</p></li>`;
      }
      listHtml += "</ul>";
      processedBlocks.push(listHtml);
      continue;
    }

    if (/^\d+\.\s/.test(trimmed)) {
      const items = trimmed.split("\n").filter((l) => l.trim());
      let listHtml = "<ol>";
      for (const item of items) {
        const liMatch = item.match(/^\d+\.\s+(.*)/);
        if (liMatch) listHtml += `<li><p>${inlineMarkdown(liMatch[1])}</p></li>`;
      }
      listHtml += "</ol>";
      processedBlocks.push(listHtml);
      continue;
    }

    const lines = trimmed.split("\n");
    const paraContent = lines.map((l) => inlineMarkdown(l)).join("<br>");
    processedBlocks.push(`<p>${paraContent}</p>`);
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
  r = r.replace(/ {2,}\n/g, "<br>");
  return r;
}

function encodeEntities(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ─── YAML frontmatter parser (minimal, no dependency) ────────────────

function parseFrontmatter(content: string): { data: Record<string, unknown>; body: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return { data: {}, body: content };

  const yamlBlock = match[1];
  const body = match[2];
  const data: Record<string, unknown> = {};

  for (const line of yamlBlock.split("\n")) {
    const kv = line.match(/^(\w[\w_]*)\s*:\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1];
    let val: unknown = kv[2].trim();

    // Arrays: [a, b, c]
    if (typeof val === "string" && val.startsWith("[") && val.endsWith("]")) {
      val = val.slice(1, -1).split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
    }
    // Booleans
    else if (val === "true") val = true;
    else if (val === "false") val = false;
    // Remove wrapping quotes from strings
    else if (typeof val === "string" && val.startsWith('"') && val.endsWith('"')) {
      val = val.slice(1, -1);
    }

    data[key] = val;
  }

  return { data, body };
}

// ─── Wikilink resolution ─────────────────────────────────────────────

function resolveWikilinks(html: string, titleToNoteId: Map<string, string>): string {
  // Obsidian image embeds already converted by markdownToHtml — skip those
  // Resolve [[link|display]] and [[link]] patterns that remain in HTML as text
  return html.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target, display) => {
    const label = display || target;
    // Strip heading anchors for matching
    const baseTarget = target.split("#")[0].trim();
    const noteId = titleToNoteId.get(baseTarget);
    if (noteId) {
      return `<a href="/dashboard/notes/${noteId}">${label}</a>`;
    }
    return label; // unresolved
  });
}

// ─── Main handler ────────────────────────────────────────────────────

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
    const userId = claimsData.claims.sub as string;

    const body = await req.json();
    const { action, path_filter, skip_existing, organize_by_folder } = body;

    // Get GitHub connection
    const { data: ghConn, error: ghErr } = await serviceClient
      .from("github_connections")
      .select("*")
      .eq("user_id", userId)
      .single();

    if (ghErr || !ghConn) {
      return new Response(JSON.stringify({ error: "No GitHub connection found" }), { status: 400, headers: corsHeaders });
    }

    const ghToken = ghConn.github_token;
    const owner = ghConn.repo_owner;
    const repo = ghConn.repo_name;
    const branch = ghConn.branch || "main";
    const vaultPath = ghConn.vault_path || "/";

    if (!owner || !repo) {
      return new Response(JSON.stringify({ error: "Repository not configured" }), { status: 400, headers: corsHeaders });
    }

    // ── Action: list-files — preview what's available ──
    if (action === "list-files") {
      const files = await listVaultFiles(ghToken, owner, repo, branch, vaultPath, path_filter);
      return new Response(JSON.stringify({ files, total: files.length }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Action: import ──
    if (action === "import") {
      const files = await listVaultFiles(ghToken, owner, repo, branch, vaultPath, path_filter);
      const mdFiles = files.filter((f: any) => f.path.endsWith(".md"));

      // Get existing notes for duplicate detection
      const { data: existingNotes } = await serviceClient
        .from("notes")
        .select("id, title")
        .eq("user_id", userId)
        .eq("is_trashed", false);

      const existingTitleMap = new Map<string, string>();
      const existingIdSet = new Set<string>();
      for (const n of existingNotes || []) {
        existingTitleMap.set(n.title.toLowerCase(), n.id);
        existingIdSet.add(n.id);
      }

      const results: { path: string; status: string; noteId?: string; error?: string }[] = [];
      const importedTitleToId = new Map<string, string>();

      // First pass: import all notes
      for (const file of mdFiles) {
        try {
          const content = await githubGetFileContent(ghToken, owner, repo, file.path, branch);
          if (!content) {
            results.push({ path: file.path, status: "error", error: "Failed to fetch file content" });
            continue;
          }

          const { data: fm, body: mdBody } = parseFrontmatter(content);

          // Check for duplicates
          const fmId = fm.id as string | undefined;
          const title = (fm.title as string) || filePathToNoteTitle(file.path);

          if (fmId && existingIdSet.has(fmId)) {
            if (skip_existing) {
              results.push({ path: file.path, status: "skipped", noteId: fmId });
              importedTitleToId.set(title, fmId);
              continue;
            }
          }

          const existingByTitle = existingTitleMap.get(title.toLowerCase());
          if (!fmId && existingByTitle && skip_existing) {
            results.push({ path: file.path, status: "skipped", noteId: existingByTitle });
            importedTitleToId.set(title, existingByTitle);
            continue;
          }

          // Parse metadata
          let metadata: Record<string, unknown> = {};
          if (fm.menerio_metadata && typeof fm.menerio_metadata === "string") {
            try {
              metadata = JSON.parse(atob(fm.menerio_metadata as string));
            } catch { /* ignore */ }
          }
          if (Object.keys(metadata).length === 0) {
            if (fm.tags) metadata.topics = Array.isArray(fm.tags) ? fm.tags : [fm.tags];
            if (fm.type) metadata.type = fm.type;
            if (fm.people) metadata.people = Array.isArray(fm.people) ? fm.people : [fm.people];
          }

          // Mark as imported from Obsidian
          metadata.imported_from = "obsidian";
          metadata.original_path = file.path;

          // Convert markdown body to HTML (wikilinks stay as text for now — resolved in pass 2)
          const htmlContent = markdownToHtml(mdBody);

          // Tags
          const tags: string[] = [];
          if (Array.isArray(fm.tags)) tags.push(...(fm.tags as string[]));
          else if (typeof fm.tags === "string") tags.push(fm.tags);

          const noteData: Record<string, unknown> = {
            user_id: userId,
            title,
            content: htmlContent,
            metadata,
            tags: [...new Set(tags)],
            source_app: "obsidian",
            entity_type: (fm.type as string) || null,
          };

          if (fm.created) noteData.created_at = fm.created;
          if (fm.modified) noteData.updated_at = fm.modified;
          if (fm.favorite === true) noteData.is_favorite = true;
          if (fm.pinned === true) noteData.is_pinned = true;

          let noteId: string;

          // Update existing or insert new
          if (fmId && existingIdSet.has(fmId)) {
            // Update
            await serviceClient.from("notes").update(noteData).eq("id", fmId).eq("user_id", userId);
            noteId = fmId;
            results.push({ path: file.path, status: "updated", noteId });
          } else if (!fmId && existingByTitle && !skip_existing) {
            // Update by title match
            await serviceClient.from("notes").update(noteData).eq("id", existingByTitle).eq("user_id", userId);
            noteId = existingByTitle;
            results.push({ path: file.path, status: "updated", noteId });
          } else {
            // Insert new
            if (fmId) noteData.id = fmId;
            const { data: inserted, error: insertErr } = await serviceClient
              .from("notes")
              .insert(noteData)
              .select("id")
              .single();

            if (insertErr) {
              results.push({ path: file.path, status: "error", error: insertErr.message });
              continue;
            }
            noteId = inserted.id;
            results.push({ path: file.path, status: "imported", noteId });
          }

          importedTitleToId.set(title, noteId);

          // Create sync log entry
          await serviceClient.from("github_sync_log").upsert(
            {
              user_id: userId,
              note_id: noteId,
              github_path: file.path,
              github_sha: file.sha || null,
              sync_status: "synced",
              sync_direction: "import",
              synced_at: new Date().toISOString(),
            },
            { onConflict: "user_id,note_id" }
          );
        } catch (err) {
          results.push({ path: file.path, status: "error", error: String(err) });
        }
      }

      // Second pass: resolve wikilinks
      const unresolvedLinks: string[] = [];
      const notesWithWikilinks = results.filter(
        (r) => (r.status === "imported" || r.status === "updated") && r.noteId
      );

      for (const r of notesWithWikilinks) {
        const { data: note } = await serviceClient
          .from("notes")
          .select("id, content")
          .eq("id", r.noteId!)
          .single();

        if (!note || !note.content.includes("[[")) continue;

        const resolved = resolveWikilinks(note.content, importedTitleToId);
        if (resolved !== note.content) {
          await serviceClient.from("notes").update({ content: resolved }).eq("id", note.id);
        }

        // Collect unresolved
        const remaining = resolved.match(/\[\[([^\]]+)\]\]/g);
        if (remaining) {
          for (const link of remaining) {
            unresolvedLinks.push(`${r.path}: ${link}`);
          }
        }
      }

      // Update last_sync_at
      await serviceClient
        .from("github_connections")
        .update({ last_sync_at: new Date().toISOString() })
        .eq("user_id", userId);

      const imported = results.filter((r) => r.status === "imported").length;
      const updated = results.filter((r) => r.status === "updated").length;
      const skipped = results.filter((r) => r.status === "skipped").length;
      const errors = results.filter((r) => r.status === "error").length;

      return new Response(
        JSON.stringify({
          success: true,
          total: mdFiles.length,
          imported,
          updated,
          skipped,
          errors,
          unresolved_links: unresolvedLinks,
          results,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(JSON.stringify({ error: "Invalid action. Use 'list-files' or 'import'." }), {
      status: 400,
      headers: corsHeaders,
    });
  } catch (err) {
    console.error("github-import-vault error:", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: corsHeaders });
  }
});

// ─── GitHub API helpers ──────────────────────────────────────────────

async function listVaultFiles(
  token: string,
  owner: string,
  repo: string,
  branch: string,
  vaultPath: string,
  pathFilter?: string
): Promise<{ path: string; sha: string; size: number; type: string }[]> {
  // Use the Git Trees API for recursive listing
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`,
    {
      headers: { Authorization: `token ${token}`, Accept: "application/vnd.github.v3+json" },
    }
  );

  if (!res.ok) throw new Error(`Failed to list repo tree: ${res.status}`);
  const data = await res.json();

  const basePath = vaultPath === "/" ? "" : vaultPath.replace(/^\/|\/$/g, "");
  const filterPath = pathFilter ? pathFilter.replace(/^\/|\/$/g, "") : null;

  return (data.tree || [])
    .filter((item: any) => {
      if (item.type !== "blob") return false;
      // Only .md files
      if (!item.path.endsWith(".md")) return false;
      // Skip dotfiles and .obsidian config
      if (item.path.includes("/.") || item.path.startsWith(".")) return false;
      if (item.path.includes(".obsidian/")) return false;
      // Apply vault path prefix
      if (basePath && !item.path.startsWith(basePath + "/") && item.path !== basePath) return false;
      // Apply path filter
      if (filterPath && !item.path.startsWith(filterPath + "/") && item.path !== filterPath) return false;
      return true;
    })
    .map((item: any) => ({
      path: item.path,
      sha: item.sha,
      size: item.size || 0,
      type: "file",
    }));
}

async function githubGetFileContent(
  token: string,
  owner: string,
  repo: string,
  path: string,
  ref: string
): Promise<string | null> {
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=${ref}`,
    {
      headers: { Authorization: `token ${token}`, Accept: "application/vnd.github.v3+json" },
    }
  );

  if (!res.ok) return null;
  const data = await res.json();
  if (!data.content) return null;

  // GitHub returns base64
  return decodeURIComponent(escape(atob(data.content.replace(/\n/g, ""))));
}

function filePathToNoteTitle(filePath: string): string {
  const baseName = filePath.split("/").pop() || filePath;
  return baseName.replace(/\.md$/i, "");
}
