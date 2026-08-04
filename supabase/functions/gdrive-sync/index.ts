/**
 * Google Drive scan importer.
 *
 * Pulls new PDFs and images out of a user's watched Drive folder, stores each
 * one as a note attachment, creates the note, and hands it to `analyze-media`
 * so the existing OCR → smart title → extraction pipeline takes over.
 *
 * Callers:
 *   - the app ("Sync now")            → user JWT, syncs that user only
 *   - the scheduled backstop / webhook → service role key, syncs due connections
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { checkBalance } from "../_shared/llm-credits.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GATEWAY = "https://connector-gateway.lovable.dev";
const CONNECTOR_ID = "google_drive";

const MAX_FILE_BYTES = 20 * 1024 * 1024; // matches the note-attachments limit
const MAX_FILES_PER_RUN = 10;

const IMAGE_MIMES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
  "image/heic",
]);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

async function driveFetch(connectionKey: string, path: string) {
  return await fetch(`${GATEWAY}/${CONNECTOR_ID}${path}`, {
    headers: {
      Authorization: `Bearer ${Deno.env.get("LOVABLE_API_KEY")}`,
      "X-Client-Api-Key": Deno.env.get("GOOGLE_DRIVE_APP_USER_CONNECTOR_CLIENT_API_KEY") ?? "",
      "X-Connection-Api-Key": connectionKey,
    },
  });
}

function extFor(mime: string, name: string): string {
  const fromName = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  if (fromName && /^[a-z0-9]{2,5}$/.test(fromName)) return fromName;
  if (mime === "application/pdf") return "pdf";
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  return "jpg";
}

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime?: string;
}

interface Conn {
  user_id: string;
  connection_key: string;
  watch_folder_id: string | null;
  target_note_folder: string | null;
  sync_enabled: boolean;
}

async function recordImport(
  userId: string,
  file: DriveFile,
  status: string,
  noteId: string | null,
  error: string | null,
) {
  await admin.from("gdrive_imports").upsert(
    {
      user_id: userId,
      file_id: file.id,
      file_name: file.name,
      mime_type: file.mimeType,
      note_id: noteId,
      status,
      error,
      imported_at: new Date().toISOString(),
    },
    { onConflict: "user_id,file_id" },
  );
}

/** Import one Drive file. Returns "imported" | "skipped" | "failed". */
async function importFile(conn: Conn, file: DriveFile): Promise<string> {
  const isPdf = file.mimeType === "application/pdf";
  const isImage = IMAGE_MIMES.has(file.mimeType);
  if (!isPdf && !isImage) {
    await recordImport(conn.user_id, file, "skipped", null, "Unsupported file type");
    return "skipped";
  }
  if (file.size && Number(file.size) > MAX_FILE_BYTES) {
    await recordImport(conn.user_id, file, "skipped", null, "File is larger than 20 MB");
    return "skipped";
  }

  const res = await driveFetch(conn.connection_key, `/drive/v3/files/${file.id}?alt=media&supportsAllDrives=true`);
  if (!res.ok) {
    const details = await res.text();
    console.error(`download failed [${res.status}] ${file.id}: ${details}`);
    await recordImport(conn.user_id, file, "failed", null, `Download failed (${res.status})`);
    return "failed";
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength > MAX_FILE_BYTES) {
    await recordImport(conn.user_id, file, "skipped", null, "File is larger than 20 MB");
    return "skipped";
  }

  const ext = extFor(file.mimeType, file.name);
  const storagePath = `${conn.user_id}/${crypto.randomUUID()}.${ext}`;
  const { error: upErr } = await admin.storage
    .from("note-attachments")
    .upload(storagePath, bytes, { contentType: file.mimeType, upsert: false });
  if (upErr) {
    console.error("upload failed", upErr);
    await recordImport(conn.user_id, file, "failed", null, `Upload failed: ${upErr.message}`);
    return "failed";
  }

  const filename = `${file.name.replace(/\.[^.]+$/, "")}-${crypto.randomUUID().slice(0, 6)}.${ext}`;
  await admin.from("note_attachments").insert({
    user_id: conn.user_id,
    filename,
    storage_path: storagePath,
    size_bytes: bytes.byteLength,
    mime_type: file.mimeType,
    source: "google_drive",
  });

  const body = [`![[${filename}]]`, "", `*Imported from Google Drive: ${file.name}*`].join("\n");

  const { data: note, error: noteErr } = await admin
    .from("notes")
    .insert({
      user_id: conn.user_id,
      title: file.name.replace(/\.[^.]+$/, "") || "Scanned document",
      content: body,
      folder_path: conn.target_note_folder || "auto-import",
      source_app: "google_drive",
      source_id: file.id,
      metadata: { source: "google_drive", drive_file_name: file.name },
    })
    .select("id")
    .single();

  if (noteErr || !note) {
    console.error("note insert failed", noteErr);
    await admin.storage.from("note-attachments").remove([storagePath]).catch(() => {});
    await recordImport(conn.user_id, file, "failed", null, `Note creation failed: ${noteErr?.message}`);
    return "failed";
  }

  // Hand off to OCR / analysis — that pipeline re-triggers process-note itself.
  try {
    const analyzeRes = await fetch(`${SUPABASE_URL}/functions/v1/analyze-media`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        note_id: note.id,
        storage_path: storagePath,
        media_type: isPdf ? "pdf" : "image",
        original_filename: filename,
      }),
    });
    if (!analyzeRes.ok) {
      console.error(`analyze-media failed [${analyzeRes.status}]: ${await analyzeRes.text()}`);
    }
  } catch (e) {
    console.error("analyze-media call failed", e);
  }

  await recordImport(conn.user_id, file, "imported", note.id, null);
  return "imported";
}

async function syncConnection(conn: Conn) {
  const summary = { imported: 0, skipped: 0, failed: 0 };
  if (!conn.watch_folder_id) {
    await admin
      .from("gdrive_connections")
      .update({ last_sync_at: new Date().toISOString(), last_error: "No Drive folder selected yet" })
      .eq("user_id", conn.user_id);
    return summary;
  }

  const balance = await checkBalance(admin, conn.user_id);
  if (!balance.allowed) {
    await admin
      .from("gdrive_connections")
      .update({
        last_sync_at: new Date().toISOString(),
        last_error: "Importing paused: no AI credits left for text extraction.",
      })
      .eq("user_id", conn.user_id);
    return summary;
  }

  const q = `'${conn.watch_folder_id.replace(/'/g, "")}' in parents and trashed=false`;
  const url =
    `/drive/v3/files?q=${encodeURIComponent(q)}` +
    `&fields=${encodeURIComponent("files(id,name,mimeType,size,modifiedTime)")}` +
    `&pageSize=100&orderBy=modifiedTime&supportsAllDrives=true&includeItemsFromAllDrives=true`;

  const listRes = await driveFetch(conn.connection_key, url);
  if (!listRes.ok) {
    const details = await listRes.text();
    console.error(`list failed [${listRes.status}]: ${details}`);
    await admin
      .from("gdrive_connections")
      .update({
        last_sync_at: new Date().toISOString(),
        last_error:
          listRes.status === 401
            ? "Google access expired — please reconnect Google Drive."
            : `Could not read the Drive folder (${listRes.status}).`,
      })
      .eq("user_id", conn.user_id);
    return summary;
  }

  const files = ((await listRes.json()) as { files?: DriveFile[] }).files ?? [];

  const { data: seenRows } = await admin
    .from("gdrive_imports")
    .select("file_id")
    .eq("user_id", conn.user_id);
  const seen = new Set((seenRows ?? []).map((r: { file_id: string }) => r.file_id));

  const pending = files.filter((f) => !seen.has(f.id)).slice(0, MAX_FILES_PER_RUN);

  for (const file of pending) {
    try {
      const outcome = await importFile(conn, file);
      summary[outcome as keyof typeof summary] += 1;
    } catch (e) {
      console.error("import failed", file.id, e);
      await recordImport(conn.user_id, file, "failed", null, e instanceof Error ? e.message : "Unknown error");
      summary.failed += 1;
    }
  }

  await admin
    .from("gdrive_connections")
    .update({ last_sync_at: new Date().toISOString(), last_error: null })
    .eq("user_id", conn.user_id);

  return summary;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace("Bearer ", "");
    const body = await req.json().catch(() => ({} as Record<string, unknown>));

    let targetUserId: string | null = null;
    const cronSecret = Deno.env.get("GDRIVE_CRON_SECRET");
    const isCron = !!cronSecret && req.headers.get("x-cron-key") === cronSecret;
    const isService = isCron || (!!token && token === SERVICE_ROLE_KEY);

    if (!isService) {
      if (!token) return json({ error: "Unauthorized" }, 401);
      const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: `Bearer ${token}` } },
      });
      const { data, error } = await userClient.auth.getClaims(token);
      if (error || !data?.claims) return json({ error: "Unauthorized" }, 401);
      targetUserId = data.claims.sub as string;
    } else if (typeof body.user_id === "string") {
      targetUserId = body.user_id;
    }

    let query = admin
      .from("gdrive_connections")
      .select("user_id, connection_key, watch_folder_id, target_note_folder, sync_enabled")
      .eq("sync_enabled", true)
      .not("connection_key", "is", null)
      .not("watch_folder_id", "is", null);
    if (targetUserId) query = query.eq("user_id", targetUserId);

    const { data: conns, error: connErr } = await query;
    if (connErr) {
      console.error("connection lookup failed", connErr);
      return json({ error: "Could not load Google Drive connections" }, 500);
    }
    const connections = (conns ?? []) as Conn[];
    if (connections.length === 0) return json({ ok: true, connections: 0 });

    // A manual "Sync now" waits for the result; scheduled runs go async.
    if (!isService && connections.length === 1) {
      const summary = await syncConnection(connections[0]);
      return json({ ok: true, ...summary });
    }

    // @ts-expect-error EdgeRuntime is a Supabase global not in TS scope
    EdgeRuntime.waitUntil(
      (async () => {
        for (const conn of connections) {
          try {
            await syncConnection(conn);
          } catch (e) {
            console.error("sync failed for", conn.user_id, e);
          }
        }
      })(),
    );

    return json({ ok: true, connections: connections.length, processing: true });
  } catch (e) {
    console.error("gdrive-sync error", e);
    return json({ error: e instanceof Error ? e.message : "Unexpected error" }, 500);
  }
});
