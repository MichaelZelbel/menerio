/**
 * Obsidian-style attachment resolver for GitHub vault imports.
 *
 * Scans a note's markdown for Obsidian wikilink embeds (`![[file.png]]`) and
 * markdown image links (`![](attachments/foo.png)`), then locates the matching
 * binary in the GitHub repo. Supports common Obsidian vault layouts:
 *
 *   - <attachmentFolder>/<file>          (Menerio default: attachments/<file>)
 *   - _resources/<file>                  (Joplin/Obsidian _resources)
 *   - _resources/<NoteName>.resources/<file>  (per-note subfolder)
 *   - <noteDir>/<file>                   (same folder as note)
 *   - <vaultRoot>/<file>                 (root)
 *
 * Resolved binaries are downloaded from GitHub, uploaded to the
 * `note-attachments` Supabase Storage bucket, and recorded in
 * `note_attachments` so the editor's wikilink resolver (Phase A) can render
 * them via signed URLs.
 */

const BINARY_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico",
  "pdf",
  "mp3", "wav", "ogg", "m4a", "flac",
  "mp4", "mov", "webm", "avi", "mkv",
  "zip",
]);

const MIME_BY_EXT: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  webp: "image/webp", svg: "image/svg+xml", bmp: "image/bmp", ico: "image/x-icon",
  pdf: "application/pdf",
  mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", m4a: "audio/mp4", flac: "audio/flac",
  mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm", avi: "video/x-msvideo", mkv: "video/x-matroska",
  zip: "application/zip",
};

function extOf(name: string): string {
  const m = name.toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : "";
}

export function isBinaryAttachment(name: string): boolean {
  return BINARY_EXTENSIONS.has(extOf(name));
}

/** Extract attachment filenames referenced by a note's markdown. */
export function extractAttachmentRefs(markdown: string): string[] {
  if (!markdown) return [];
  const names = new Set<string>();

  // ![[filename.ext]] or ![[filename.ext|alt]]
  const wikiRe = /!\[\[([^\]|#]+?)(?:[#|][^\]]*)?\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = wikiRe.exec(markdown))) {
    const raw = m[1].trim();
    if (raw && isBinaryAttachment(raw)) names.add(basename(raw));
  }

  // ![alt](path/to/file.ext) — only relative paths
  const mdRe = /!\[[^\]]*\]\(([^)]+)\)/g;
  while ((m = mdRe.exec(markdown))) {
    const url = m[1].trim();
    if (/^https?:\/\//i.test(url)) continue;
    const name = basename(url.split("?")[0].split("#")[0]);
    if (name && isBinaryAttachment(name)) names.add(name);
  }

  return [...names];
}

function basename(p: string): string {
  const cleaned = p.replace(/^\.?\//, "");
  return cleaned.split("/").pop() || cleaned;
}

/** Build candidate GitHub paths for a referenced attachment filename. */
export function buildCandidatePaths(
  filename: string,
  notePath: string,
  vaultRoot: string,
  attachmentFolder: string,
): string[] {
  const noteDir = notePath.includes("/") ? notePath.slice(0, notePath.lastIndexOf("/")) : "";
  const noteBase = (notePath.split("/").pop() || "").replace(/\.md$/i, "");
  const root = (vaultRoot || "").replace(/^\/|\/$/g, "");
  const folder = (attachmentFolder || "attachments").replace(/^\/|\/$/g, "");

  const prefixes = [root, ""].filter((p, i, arr) => arr.indexOf(p) === i);
  const subdirs = [
    folder,
    "_resources",
    `_resources/${noteBase}.resources`,
    noteDir,
    "",
  ];

  const out: string[] = [];
  for (const pre of prefixes) {
    for (const sub of subdirs) {
      const parts = [pre, sub, filename].filter(Boolean);
      out.push(parts.join("/"));
    }
  }
  // Deduplicate while preserving order
  return [...new Set(out)];
}

export interface GitHubBlobLookup {
  /** Map of normalized GitHub path → { sha, size }. */
  byPath: Map<string, { sha: string; size: number }>;
}

export function buildBlobLookup(tree: { path: string; type: string; sha: string; size?: number }[]): GitHubBlobLookup {
  const byPath = new Map<string, { sha: string; size: number }>();
  for (const item of tree) {
    if (item.type !== "blob") continue;
    byPath.set(item.path, { sha: item.sha, size: item.size || 0 });
  }
  return { byPath };
}

async function githubGetBlobBytes(token: string, owner: string, repo: string, sha: string): Promise<Uint8Array | null> {
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/blobs/${sha}`,
    { headers: { Authorization: `token ${token}`, Accept: "application/vnd.github.v3+json" } },
  );
  if (!res.ok) return null;
  const data = await res.json();
  if (!data.content) return null;
  const b64 = (data.content as string).replace(/\n/g, "");
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface SyncAttachmentsResult {
  resolved: number;
  unresolved: string[];
  errors: string[];
}

/**
 * Resolve and import all attachments referenced by a note's markdown.
 *
 * @param supabase  Service-role client
 * @param userId    Owner
 * @param noteId    Target note id
 * @param markdown  Note content (markdown)
 * @param notePath  GitHub path of the note (e.g. "notes/foo.md")
 * @param ghToken   GitHub token
 * @param owner     Repo owner
 * @param repo      Repo name
 * @param branch    Branch
 * @param vaultRoot Vault root path inside the repo
 * @param attachmentFolder  Preferred attachment folder name (default "attachments")
 * @param blobs     Pre-fetched recursive tree blob lookup (avoids repeated tree calls)
 */
export async function importNoteAttachments(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  userId: string,
  noteId: string,
  markdown: string,
  notePath: string,
  ghToken: string,
  owner: string,
  repo: string,
  _branch: string,
  vaultRoot: string,
  attachmentFolder: string,
  blobs: GitHubBlobLookup,
): Promise<SyncAttachmentsResult> {
  const result: SyncAttachmentsResult = { resolved: 0, unresolved: [], errors: [] };
  const refs = extractAttachmentRefs(markdown);
  if (refs.length === 0) return result;

  for (const filename of refs) {
    try {
      // Skip if we already imported this filename for this user (dedup by sha later)
      const candidates = buildCandidatePaths(filename, notePath, vaultRoot, attachmentFolder);
      let matchedPath: string | null = null;
      let matchedSha: string | null = null;
      for (const cand of candidates) {
        const hit = blobs.byPath.get(cand);
        if (hit) { matchedPath = cand; matchedSha = hit.sha; break; }
      }

      if (!matchedPath || !matchedSha) {
        result.unresolved.push(filename);
        continue;
      }

      // Skip if note_attachments already has this filename for this user with same github_sha
      const { data: existing } = await supabase
        .from("note_attachments")
        .select("id, github_sha, storage_path")
        .eq("user_id", userId)
        .eq("filename", filename)
        .maybeSingle();

      if (existing && existing.github_sha === matchedSha) {
        result.resolved++;
        continue;
      }

      // Download blob bytes from GitHub
      const bytes = await githubGetBlobBytes(ghToken, owner, repo, matchedSha);
      if (!bytes) {
        result.errors.push(`${filename}: failed to fetch blob`);
        continue;
      }

      const ext = extOf(filename);
      const mime = MIME_BY_EXT[ext] || "application/octet-stream";
      const hash = await sha256Hex(bytes);

      // Upload to Supabase Storage under user_id/<filename>
      const storagePath = `${userId}/${filename}`;
      const upRes = await supabase.storage
        .from("note-attachments")
        .upload(storagePath, bytes, { contentType: mime, upsert: true });

      if (upRes.error) {
        result.errors.push(`${filename}: upload failed — ${upRes.error.message}`);
        continue;
      }

      // Upsert note_attachments row
      const row = {
        user_id: userId,
        filename,
        storage_path: storagePath,
        mime_type: mime,
        size_bytes: bytes.byteLength,
        sha256: hash,
        source: "github_import",
        github_path: matchedPath,
        github_sha: matchedSha,
        github_synced_at: new Date().toISOString(),
      };

      if (existing) {
        await supabase.from("note_attachments").update(row).eq("id", existing.id);
      } else {
        await supabase.from("note_attachments").insert(row);
      }

      result.resolved++;
    } catch (err) {
      result.errors.push(`${filename}: ${String(err)}`);
    }
  }

  return result;
}
