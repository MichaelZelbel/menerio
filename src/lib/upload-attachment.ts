import { supabase } from "@/integrations/supabase/client";

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB

export type MediaType = "image" | "video" | "audio" | "pdf" | "unknown";

const MIME_MAP: Record<string, MediaType> = {
  "image/png": "image",
  "image/jpeg": "image",
  "image/gif": "image",
  "image/webp": "image",
  "image/svg+xml": "image",
  "video/mp4": "video",
  "video/webm": "video",
  "video/ogg": "video",
  "video/quicktime": "video",
  "audio/mpeg": "audio",
  "audio/ogg": "audio",
  "audio/wav": "audio",
  "audio/webm": "audio",
  "audio/mp4": "audio",
  "application/pdf": "pdf",
};

export function detectMediaType(file: File): MediaType {
  return MIME_MAP[file.type] || "unknown";
}

export function validateFile(file: File): string | null {
  if (file.size > MAX_FILE_SIZE) {
    return `File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max is 20 MB.`;
  }
  if (detectMediaType(file) === "unknown") {
    return `Unsupported file type: ${file.type || "unknown"}`;
  }
  return null;
}

/**
 * Sanitize a filename for Obsidian-compatible storage.
 * Removes filesystem-unsafe chars but preserves readability.
 */
function sanitizeFilename(name: string): string {
  // Strip path
  const base = name.replace(/^.*[\\/]/, "");
  // Replace unsafe chars with hyphens, collapse repeats
  const safe = base
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/-+/g, "-")
    .trim();
  return safe || `attachment-${Math.random().toString(36).slice(2, 8)}.bin`;
}

/**
 * Find a non-colliding filename for this user by trying suffixes -2, -3, …
 */
async function resolveUniqueFilename(userId: string, desired: string): Promise<string> {
  const ext = desired.includes(".") ? desired.slice(desired.lastIndexOf(".")) : "";
  const stem = ext ? desired.slice(0, -ext.length) : desired;

  // Fetch existing filenames matching pattern (cheap: limited rows per user)
  const { data } = await supabase
    .from("note_attachments")
    .select("filename")
    .eq("user_id", userId)
    .ilike("filename", `${stem}%${ext}`);

  const existing = new Set((data || []).map((r) => r.filename));
  if (!existing.has(desired)) return desired;

  for (let i = 2; i < 1000; i++) {
    const candidate = `${stem}-${i}${ext}`;
    if (!existing.has(candidate)) return candidate;
  }
  // Fallback
  return `${stem}-${Date.now()}${ext}`;
}

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export interface UploadResult {
  url: string;
  mediaType: MediaType;
  storagePath: string;
  /** Obsidian-friendly filename used for `![[filename.ext]]` wikilink embeds. */
  filename: string;
}

export async function uploadAttachment(file: File, userId: string): Promise<UploadResult> {
  const error = validateFile(file);
  if (error) throw new Error(error);

  const mediaType = detectMediaType(file);
  const ext = (file.name.split(".").pop() || "bin").toLowerCase();
  const storagePath = `${userId}/${crypto.randomUUID()}.${ext}`;

  // Resolve a unique, Obsidian-compatible filename
  const desired = sanitizeFilename(file.name);
  const filename = await resolveUniqueFilename(userId, desired);

  // Upload to bucket
  const { error: uploadError } = await supabase.storage
    .from("note-attachments")
    .upload(storagePath, file, { contentType: file.type, upsert: false });

  if (uploadError) throw uploadError;

  // Compute sha256 (best-effort; non-fatal)
  let sha256: string | null = null;
  try {
    sha256 = await sha256Hex(await file.arrayBuffer());
  } catch {
    // ignore
  }

  // Register in note_attachments
  const { error: insertError } = await supabase.from("note_attachments").insert({
    user_id: userId,
    filename,
    storage_path: storagePath,
    size_bytes: file.size,
    mime_type: file.type || null,
    sha256,
    source: "menerio",
  });
  if (insertError) {
    // Not fatal for the immediate UX, but log so we notice issues
    console.error("note_attachments insert failed:", insertError);
  }

  // Signed URL for immediate display fallback (used by legacy code paths)
  const { data, error: signedUrlError } = await supabase.storage
    .from("note-attachments")
    .createSignedUrl(storagePath, 60 * 60 * 24 * 7);

  if (signedUrlError) throw signedUrlError;

  return { url: data.signedUrl, mediaType, storagePath, filename };
}

/**
 * Resolve an Obsidian wikilink-style filename to a fresh signed URL
 * by looking up the attachment record. Returns null when not found.
 *
 * Usage: `![[my-image.png]]` → `https://...signed-url`
 */
export async function resolveWikilinkAttachment(
  userId: string,
  filename: string
): Promise<{ url: string; mimeType: string | null } | null> {
  const { data, error } = await supabase
    .from("note_attachments")
    .select("storage_path, mime_type")
    .eq("user_id", userId)
    .eq("filename", filename)
    .maybeSingle();

  if (error || !data) return null;

  const { data: signed, error: urlError } = await supabase.storage
    .from("note-attachments")
    .createSignedUrl(data.storage_path, 60 * 60 * 24 * 6);

  if (urlError || !signed) return null;
  return { url: signed.signedUrl, mimeType: data.mime_type };
}
