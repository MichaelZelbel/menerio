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

export async function uploadAttachment(
  file: File,
  userId: string
): Promise<{ url: string; mediaType: MediaType }> {
  const error = validateFile(file);
  if (error) throw new Error(error);

  const mediaType = detectMediaType(file);
  const ext = file.name.split(".").pop() || "bin";
  const path = `${userId}/${crypto.randomUUID()}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from("note-attachments")
    .upload(path, file, { contentType: file.type, upsert: false });

  if (uploadError) throw uploadError;

  const { data } = supabase.storage
    .from("note-attachments")
    .getPublicUrl(path);

  return { url: data.publicUrl, mediaType };
}
