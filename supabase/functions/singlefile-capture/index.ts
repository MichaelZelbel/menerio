/**
 * SingleFile Web Clipper capture endpoint.
 *
 * Accepts multipart/form-data uploads from the SingleFile Chrome extension
 * (https://github.com/gildas-lormeau/SingleFile) configured to "Upload to
 * a REST Form API". Creates a Menerio note with:
 *   - Markdown body containing the readable text + a wikilink to the snapshot
 *   - The original HTML snapshot stored in the `note-attachments` bucket
 *   - source_app="singlefile" so the existing source-badge UI shows it
 *
 * Auth: existing Hub API key system (Bearer mnr_...). Requires `notes` scope.
 *
 * Endpoint: POST /functions/v1/singlefile-capture
 * Form fields:
 *   - file       (required) the HTML snapshot
 *   - url        (optional) original page URL
 *   - title      (optional) page title (overrides <title> in HTML)
 *   - tags       (optional) comma-separated tags
 *   - folder     (optional) folder path (e.g. "Web Clips")
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authenticateHubKey, requireScope } from "../_shared/hub-auth.ts";
import { checkRateLimit } from "../_shared/hub-rate-limit.ts";
import {
  decodeEntities,
  extractCanonicalUrl,
  extractHtmlTitle,
  extractMetaDescription,
  htmlToPlainText,
  safeHostname,
} from "../_shared/html-text.ts";

const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20 MB — matches note-attachments policy
const HTML_MIME_TYPES = new Set([
  "text/html",
  "application/xhtml+xml",
]);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function err(message: string, status: number) {
  return json({ ok: false, error: message }, status);
}

/** SingleFile injects this comment when saving with metadata. Try to parse it. */
function extractSingleFileComment(html: string): { url?: string; title?: string } {
  // Format: <!-- Page saved with SingleFile / url: https://... / saved date: ... -->
  const m = html.match(/<!--[^]*?Page saved with SingleFile[\s\S]*?-->/i);
  if (!m) return {};
  const block = m[0];
  const urlMatch = block.match(/url:\s*(\S+)/i);
  return { url: urlMatch ? urlMatch[1].trim() : undefined };
}

function sanitizeFilename(name: string, fallback: string): string {
  const base = (name || "").replace(/^.*[\\/]/, "");
  const safe = base
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/-+/g, "-")
    .trim();
  if (!safe) return fallback;
  // Ensure .html extension for snapshots
  return safe.toLowerCase().endsWith(".html") || safe.toLowerCase().endsWith(".htm")
    ? safe
    : `${safe}.html`;
}

/** Sanitize a non-HTML filename (for hero images) — keeps the original ext. */
function sanitizeImageName(name: string, fallback: string): string {
  const base = (name || "").replace(/^.*[\\/]/, "").trim();
  const safe = base
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
  return safe || fallback;
}

const HERO_MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

/** Class/id patterns that almost always indicate a non-hero image. */
const NON_HERO_PATTERN = /\b(avatar|logo|icon|tracker|pixel|sprite|emoji|badge)\b/i;

/** Extract the first non-tracking <img> src from <body>, with a min-size hint. */
function extractFirstBodyImageSrc(html: string): string | null {
  const bodyMatch = html.match(/<body[\s\S]*?<\/body>/i);
  let scope = bodyMatch ? bodyMatch[0] : html;
  // Strip header/nav/footer where logos and avatars typically live.
  scope = scope
    .replace(/<header[\s\S]*?<\/header>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ");
  const imgRe = /<img\b([^>]*?)>/gi;
  let m: RegExpExecArray | null;
  while ((m = imgRe.exec(scope)) !== null) {
    const attrs = m[1];
    const srcMatch = attrs.match(/\bsrc\s*=\s*["']([^"']+)["']/i);
    if (!srcMatch) continue;
    const src = srcMatch[1].trim();
    if (!src) continue;
    // Skip obvious non-hero candidates by class/id/alt.
    const classMatch = attrs.match(/\b(?:class|id|alt)\s*=\s*["']([^"']*)["']/gi);
    if (classMatch && classMatch.some((a) => NON_HERO_PATTERN.test(a))) continue;
    // Skip obvious 1x1 trackers and tiny icons.
    const widthMatch = attrs.match(/\bwidth\s*=\s*["']?(\d+)/i);
    const heightMatch = attrs.match(/\bheight\s*=\s*["']?(\d+)/i);
    const w = widthMatch ? parseInt(widthMatch[1], 10) : null;
    const h = heightMatch ? parseInt(heightMatch[1], 10) : null;
    if ((w !== null && w < 200) || (h !== null && h < 120)) continue;
    // Require a reasonable image MIME for data URIs.
    if (src.startsWith("data:")) {
      const mime = src.slice(5, src.indexOf(";")).toLowerCase();
      if (!HERO_MIME_TO_EXT[mime]) continue;
    }
    return src;
  }
  return null;
}

/**
 * Order-agnostic <meta> attribute lookup: scans every <meta> tag and returns
 * the `content` value of the first whose `attrName="attrVal"` matches,
 * regardless of attribute order in the source.
 */
function findMetaContent(html: string, attrName: string, attrVal: string): string | null {
  const tagRe = /<meta\b[^>]*>/gi;
  const wantAttr = new RegExp(`\\b${attrName}\\s*=\\s*["']${attrVal}["']`, "i");
  const contentAttr = /\bcontent\s*=\s*["']([^"']+)["']/i;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(html)) !== null) {
    const tag = m[0];
    if (!wantAttr.test(tag)) continue;
    const c = tag.match(contentAttr);
    if (c && c[1].trim()) return decodeEntities(c[1]).trim();
  }
  return null;
}

function findLinkRelHref(html: string, rel: string): string | null {
  const tagRe = /<link\b[^>]*>/gi;
  const wantRel = new RegExp(`\\brel\\s*=\\s*["']${rel}["']`, "i");
  const hrefAttr = /\bhref\s*=\s*["']([^"']+)["']/i;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(html)) !== null) {
    const tag = m[0];
    if (!wantRel.test(tag)) continue;
    const h = tag.match(hrefAttr);
    if (h && h[1].trim()) return decodeEntities(h[1]).trim();
  }
  return null;
}

/** Find a hero image candidate URL/data-URI from meta tags first, then body. */
function findHeroImageCandidate(html: string): string | null {
  return (
    findMetaContent(html, "property", "og:image:secure_url") ||
    findMetaContent(html, "property", "og:image:url") ||
    findMetaContent(html, "property", "og:image") ||
    findMetaContent(html, "name", "og:image") || // some sites use name= by mistake
    findMetaContent(html, "name", "twitter:image:src") ||
    findMetaContent(html, "name", "twitter:image") ||
    findLinkRelHref(html, "image_src") ||
    extractFirstBodyImageSrc(html)
  );
}

/** Decode a base64 data: URI to bytes + mime. */
function decodeDataUri(uri: string): { bytes: Uint8Array; mime: string } | null {
  try {
    const comma = uri.indexOf(",");
    if (comma < 0) return null;
    const meta = uri.slice(5, comma); // strip "data:"
    const semi = meta.indexOf(";");
    const mime = (semi >= 0 ? meta.slice(0, semi) : meta).toLowerCase();
    const isBase64 = meta.toLowerCase().includes(";base64");
    const payload = uri.slice(comma + 1);
    if (!isBase64) return null; // we only support base64 for binary images
    const bin = atob(payload);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { bytes, mime };
  } catch {
    return null;
  }
}

const MAX_HERO_BYTES = 5 * 1024 * 1024; // 5 MB

/**
 * Block hosts that point at private, loopback, link-local, or cloud-metadata
 * addresses. The hero-image URL comes from attacker-controlled uploaded HTML,
 * so fetching it server-side is an SSRF vector (e.g. http://169.254.169.254/…).
 * Note: literal IPs and known-internal hostnames are blocked; a public hostname
 * that *resolves* to a private IP (DNS rebinding) is not caught here, since the
 * Supabase edge runtime doesn't expose reliable DNS resolution — this closes the
 * common vectors, not every theoretical one.
 */
function isBlockedHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, ""); // strip IPv6 brackets
  if (!h) return true;
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return true;
  if (h === "metadata.google.internal" || h === "instance-data") return true;

  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;          // link-local incl. metadata
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && b === 168) return true;          // private
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    return false;
  }
  if (h.includes(":")) {
    if (h === "::1" || h === "::") return true;
    if (h.startsWith("fe80") || h.startsWith("fc") || h.startsWith("fd")) return true;
    const mapped = h.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/); // IPv4-mapped IPv6
    if (mapped) return isBlockedHost(mapped[1]);
    return false;
  }
  return false; // ordinary public hostname
}

/**
 * Fetch an image URL with SSRF protection: only http(s), reject blocked hosts,
 * and follow redirects manually (re-validating each hop) so a redirect into
 * internal address space is caught rather than blindly followed.
 */
async function fetchImageSafely(startUrl: string): Promise<Response | null> {
  let url = startUrl;
  for (let hop = 0; hop < 4; hop++) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return null;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    if (isBlockedHost(parsed.hostname)) {
      console.warn(`[singlefile-capture] blocked SSRF hero-image fetch to ${parsed.hostname}`);
      return null;
    }
    const res = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(5_000),
      headers: { "User-Agent": "Menerio-WebClipper/1.0" },
    });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) return null;
      url = new URL(loc, url).toString(); // resolve relative redirects, re-check next loop
      continue;
    }
    return res;
  }
  return null; // too many redirects
}

/** Resolve a hero candidate (data URI or http(s)) into { bytes, mime, ext }. */
async function resolveHeroImage(
  candidate: string,
  pageUrl: string | null,
): Promise<{ bytes: Uint8Array; mime: string; ext: string } | null> {
  if (candidate.startsWith("data:")) {
    const decoded = decodeDataUri(candidate);
    if (!decoded) return null;
    const ext = HERO_MIME_TO_EXT[decoded.mime];
    if (!ext) return null;
    if (decoded.bytes.byteLength > MAX_HERO_BYTES) return null;
    return { ...decoded, ext };
  }

  // Resolve protocol-relative or relative URLs against the page URL when possible.
  let resolved: string;
  try {
    if (candidate.startsWith("//")) {
      resolved = `https:${candidate}`;
    } else if (/^https?:\/\//i.test(candidate)) {
      resolved = candidate;
    } else if (pageUrl) {
      resolved = new URL(candidate, pageUrl).toString();
    } else {
      return null;
    }
  } catch {
    return null;
  }

  try {
    const res = await fetchImageSafely(resolved);
    if (!res || !res.ok) return null;
    const mime = (res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    const ext = HERO_MIME_TO_EXT[mime];
    if (!ext) return null;
    const buf = await res.arrayBuffer();
    if (buf.byteLength === 0 || buf.byteLength > MAX_HERO_BYTES) return null;
    return { bytes: new Uint8Array(buf), mime, ext };
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return err("Only POST is supported.", 405);
  }

  // ── Auth ──
  const { result: auth, error: authErr } = await authenticateHubKey(req);
  if (authErr) return authErr;
  const scopeErr = requireScope(auth!.scopes, "notes");
  if (scopeErr) return scopeErr;

  // ── Rate limit ──
  const rl = await checkRateLimit(auth!.keyId);
  if (!rl.allowed) return rl.error!;

  const userId = auth!.userId;

  // ── Parse multipart ──
  const contentType = req.headers.get("content-type") || "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
    return err("Expected multipart/form-data upload.", 400);
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch (e) {
    return err(`Invalid multipart body: ${(e as Error).message}`, 400);
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return err("Missing required form field 'file'.", 400);
  }
  if (file.size === 0) {
    return err("Uploaded file is empty.", 400);
  }
  if (file.size > MAX_FILE_BYTES) {
    return err(
      `File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max is 20 MB.`,
      413,
    );
  }

  // MIME / extension validation. SingleFile sends text/html, but some
  // clients send application/octet-stream — accept that only when the
  // filename clearly indicates HTML.
  const fileMime = (file.type || "").toLowerCase();
  const fileNameLower = (file.name || "").toLowerCase();
  const looksLikeHtmlByName =
    fileNameLower.endsWith(".html") || fileNameLower.endsWith(".htm");
  if (
    !HTML_MIME_TYPES.has(fileMime) &&
    !(fileMime === "application/octet-stream" && looksLikeHtmlByName) &&
    !(fileMime === "" && looksLikeHtmlByName)
  ) {
    return err(
      `Unsupported file type '${fileMime || "unknown"}'. Expected HTML.`,
      400,
    );
  }

  const explicitUrl = (form.get("url") as string | null)?.trim() || null;
  const explicitTitle = (form.get("title") as string | null)?.trim() || null;
  const tagsRaw = (form.get("tags") as string | null)?.trim() || "";
  const folderPath = (form.get("folder") as string | null)?.trim() || "Web Clips";

  const tags = tagsRaw
    ? tagsRaw.split(",").map((t) => t.trim()).filter(Boolean).slice(0, 20)
    : ["web-clip"];

  // ── Read & inspect HTML ──
  let htmlText: string;
  try {
    htmlText = await file.text();
  } catch (e) {
    return err(`Could not read file: ${(e as Error).message}`, 400);
  }

  // Quick sanity: must look like HTML.
  if (!/<html[\s>]/i.test(htmlText) && !/<!doctype\s+html/i.test(htmlText)) {
    return err("File does not appear to be an HTML document.", 400);
  }

  const sfMeta = extractSingleFileComment(htmlText);
  const htmlTitle = extractHtmlTitle(htmlText);
  const description = extractMetaDescription(htmlText);
  const canonical = extractCanonicalUrl(htmlText);
  const sourceUrl = explicitUrl || canonical || sfMeta.url || null;
  const hostname = safeHostname(sourceUrl);

  const title =
    explicitTitle ||
    htmlTitle ||
    hostname ||
    "Clipped webpage";

  const plainText = htmlToPlainText(htmlText);

  // ── Upload snapshot to note-attachments ──
  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const fallbackName = `web-clip-${new Date().toISOString().slice(0, 10)}-${crypto
    .randomUUID()
    .slice(0, 6)}.html`;
  const baseName = sanitizeFilename(file.name || `${title}.html`, fallbackName);
  // Make filename unique-ish per upload to avoid collisions across many clips.
  const uniqueName = baseName.replace(
    /\.html?$/i,
    `-${crypto.randomUUID().slice(0, 6)}.html`,
  );
  const storagePath = `${userId}/${crypto.randomUUID()}.html`;

  const snapshotBytes = new TextEncoder().encode(htmlText);

  const { error: uploadErr } = await supabaseAdmin.storage
    .from("note-attachments")
    .upload(storagePath, snapshotBytes, {
      contentType: "text/html; charset=utf-8",
      upsert: false,
    });
  if (uploadErr) {
    console.error("singlefile-capture upload failed:", uploadErr);
    return err(`Snapshot upload failed: ${uploadErr.message}`, 500);
  }

  // Compute sha256 (best effort)
  let sha256: string | null = null;
  try {
    const digest = await crypto.subtle.digest("SHA-256", snapshotBytes);
    sha256 = Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } catch { /* ignore */ }

  const { error: regErr } = await supabaseAdmin.from("note_attachments").insert({
    user_id: userId,
    filename: uniqueName,
    storage_path: storagePath,
    size_bytes: snapshotBytes.byteLength,
    mime_type: "text/html",
    sha256,
    source: "singlefile",
  });
  if (regErr) {
    console.warn("note_attachments insert failed (non-fatal):", regErr.message);
  }

  // ── Hero image (best-effort, non-fatal) ──
  let heroFilename: string | null = null;
  let heroStoragePath: string | null = null;
  try {
    const candidate = findHeroImageCandidate(htmlText);
    if (candidate) {
      const hero = await resolveHeroImage(candidate, sourceUrl);
      if (hero) {
        const hostSlug = (hostname || "page")
          .replace(/[^a-z0-9]+/gi, "-")
          .replace(/^-+|-+$/g, "")
          .toLowerCase() || "page";
        const baseHero = sanitizeImageName(`${hostSlug}-hero.${hero.ext}`, `hero.${hero.ext}`);
        heroFilename = baseHero.replace(
          new RegExp(`\\.${hero.ext}$`, "i"),
          `-${crypto.randomUUID().slice(0, 6)}.${hero.ext}`,
        );
        heroStoragePath = `${userId}/${crypto.randomUUID()}.${hero.ext}`;

        const { error: heroUploadErr } = await supabaseAdmin.storage
          .from("note-attachments")
          .upload(heroStoragePath, hero.bytes, {
            contentType: hero.mime,
            upsert: false,
          });
        if (heroUploadErr) {
          console.warn("hero upload failed (non-fatal):", heroUploadErr.message);
          heroFilename = null;
          heroStoragePath = null;
        } else {
          const { error: heroRegErr } = await supabaseAdmin.from("note_attachments").insert({
            user_id: userId,
            filename: heroFilename,
            storage_path: heroStoragePath,
            size_bytes: hero.bytes.byteLength,
            mime_type: hero.mime,
            source: "singlefile",
          });
          if (heroRegErr) {
            console.warn("hero attachment insert failed (non-fatal):", heroRegErr.message);
          }
        }
      }
    }
  } catch (e) {
    console.warn("hero extraction failed (non-fatal):", (e as Error).message);
  }

  // ── Build Markdown body ──
  // Obsidian-compatible: links via [text](url), embed snapshot via wikilink.
  const lines: string[] = [];
  if (heroFilename) {
    lines.push(`![[${heroFilename}]]`);
    lines.push("");
  }
  if (sourceUrl) lines.push(`**Source:** [${hostname || sourceUrl}](${sourceUrl})`);
  if (description) {
    lines.push("");
    lines.push(`> ${description}`);
  }
  lines.push("");
  lines.push(`📎 [[${uniqueName}]] _(original snapshot)_`);
  if (plainText) {
    lines.push("");
    lines.push("---");
    lines.push("");
    lines.push(plainText);
  }
  const content = lines.join("\n");

  // ── Insert note ──
  const { data: note, error: noteErr } = await supabaseAdmin
    .from("notes")
    .insert({
      user_id: userId,
      title,
      content,
      tags,
      folder_path: folderPath,
      source_app: "singlefile",
      source_url: sourceUrl,
      // Make each clip unique so users can re-clip the same URL multiple times
      // (e.g. to capture page changes over time). The dedup index covers
      // (user_id, source_app, source_id) so we append a per-capture suffix.
      source_id: `${sourceUrl || hostname || "clip"}#${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
      metadata: {
        is_quick_capture: false,
        source: "singlefile",
        web_clip: {
          url: sourceUrl,
          hostname,
          html_title: htmlTitle,
          description,
          snapshot_attachment: uniqueName,
          snapshot_storage_path: storagePath,
          hero_image_attachment: heroFilename,
          hero_image_storage_path: heroStoragePath,
          captured_at: new Date().toISOString(),
        },
      },
    })
    .select("id, title")
    .single();

  if (noteErr || !note) {
    console.error("singlefile-capture note insert failed:", noteErr);
    // Best-effort cleanup of the uploaded snapshot.
    await supabaseAdmin.storage.from("note-attachments").remove([storagePath]).catch(() => {});
    return err(`Note creation failed: ${noteErr?.message || "unknown error"}`, 500);
  }

  // Trigger background processing (embeddings + AI metadata) — fire-and-forget.
  fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/process-note`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
    },
    body: JSON.stringify({ note_id: note.id }),
  }).catch((e) => console.warn("process-note trigger failed:", e));

  return json(
    {
      ok: true,
      noteId: note.id,
      title: note.title,
      sourceUrl,
    },
    201,
  );
});
