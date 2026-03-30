import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

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

    // Handle bulk sync
    if (bulk) {
      return await handleBulkSync(serviceClient, userId, ghToken, owner, repo, branch, vaultPath);
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
    return new Response(JSON.stringify(result), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("github-sync-export error:", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: corsHeaders });
  }
});

async function syncSingleNote(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  ghToken: string,
  owner: string,
  repo: string,
  branch: string,
  vaultPath: string,
  note: Record<string, unknown>,
  action: string
) {
  const meta = (note.metadata || {}) as Record<string, unknown>;
  const fileName = sanitizeFileName(String(note.title || "Untitled"));
  const subDir = meta.is_quick_capture ? "Inbox" : "";
  const base = vaultPath === "/" ? "" : String(vaultPath).replace(/^\/|\/$/g, "");
  const filePath = [base, subDir, `${fileName}.md`].filter(Boolean).join("/");

  try {
    if (action === "delete") {
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
    const mdBody = htmlToMarkdown(String(note.content || ""));
    const fullContent = `${frontmatter}\n\n${mdBody}`;

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

async function handleBulkSync(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  ghToken: string,
  owner: string,
  repo: string,
  branch: string,
  vaultPath: string,
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

  // Update last_sync_at
  await supabase
    .from("github_connections")
    .update({ last_sync_at: new Date().toISOString() })
    .eq("user_id", userId);

  const succeeded = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;

  return new Response(
    JSON.stringify({ success: true, total: results.length, succeeded, failed, results }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
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
