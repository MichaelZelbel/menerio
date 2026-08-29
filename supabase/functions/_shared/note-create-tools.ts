/**
 * Create-only note tools for the chat agents.
 *
 * The in-note editor tools (`_shared/note-edit-tools.ts`) can only touch the
 * note the user currently has open, which left the main-page assistant with no
 * way to act at all: it could read the whole brain and change nothing in it.
 *
 * These tools close that gap with the narrowest capability that does the job.
 *
 * Design rules (all enforced here, not left to the model):
 *  - CREATE ONLY. Nothing here updates, moves or trashes an existing note.
 *    Creating is additive, so the worst outcome of a bad call (including one
 *    provoked by instructions hidden in a web page or in a note the agent read)
 *    is a junk note the user can see and delete. Editing notes the user is not
 *    looking at would be silent and unrecoverable, so it is deliberately absent.
 *  - Folders are matched case-insensitively against what already exists, so
 *    "deepseek" lands in an existing `DeepSeek` instead of beside it.
 *  - Idempotency: the same note is not created twice inside one turn.
 *  - A hard per-turn cap, so a loop or an injected instruction cannot flood
 *    the user's brain with notes.
 *  - The created note's body is never echoed back to the model. Tools return a
 *    receipt (id, title, folder, word count) and nothing else.
 *
 * No Deno APIs in this file: it is imported directly by the Node test runner
 * (see `vitest.config.ts`). The side effect the edge runtime owns, triggering
 * the process-note pipeline, is injected by the caller as `onCreated`.
 */

/** Max notes one chat turn may create. */
export const MAX_NOTES_PER_TURN = 3;

/** Max characters accepted for a single note body. */
const MAX_CONTENT_CHARS = 200_000;

/** Max characters of a title. Longer titles get truncated, not rejected. */
const MAX_TITLE_CHARS = 200;

export interface CreatedNote {
  id: string;
  title: string;
  folder_path: string;
}

export interface NoteCreateSession {
  /** Dedupe map: tool+args -> serialized result. */
  seen: Map<string, string>;
  /** Notes created during this turn, in order. */
  created: CreatedNote[];
  /** Folder paths created during this turn (so the UI can refresh the tree). */
  foldersCreated: string[];
}

export function createNoteCreateSession(): NoteCreateSession {
  return { seen: new Map(), created: [], foldersCreated: [] };
}

export const NOTE_CREATE_TOOL_SCHEMAS = [
  {
    type: "function",
    function: {
      name: "create_note",
      description:
        "Create a NEW note in the user's brain. Use this whenever the user asks you to save, write, capture, draft or make a note. It only ever adds a new note, and can never change or delete an existing one. If the user named a folder, call list_note_folders first so you place it in the folder they already have instead of making a near-duplicate.",
      parameters: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description: "The note's title. Keep it short and specific.",
          },
          content: {
            type: "string",
            description:
              "The full note body in Markdown. Write the actual content here, and do not also paste it into the chat.",
          },
          folder: {
            type: "string",
            description:
              "Optional folder path, e.g. 'DeepSeek' or 'Research/Models'. Matched case-insensitively against existing folders, and created if it does not exist. Omit to put the note at the top level.",
          },
          tags: {
            type: "array",
            items: { type: "string" },
            description: "Optional tags for the new note.",
          },
        },
        required: ["title", "content"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_note_folders",
      description:
        "List the folders that already exist in the user's notes. Call this before create_note whenever the user names a folder, so you reuse their exact folder instead of creating a near-duplicate with different capitalisation.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
  },
];

export const NOTE_CREATE_TOOL_NAMES = NOTE_CREATE_TOOL_SCHEMAS.map(
  (t) => t.function.name,
);

/**
 * Non-negotiable rules for creating notes, appended to whatever prompt is
 * configured. It lives here rather than in one function so note-chat and
 * conversation-chat share a single copy, and it is appended in CODE because the
 * system prompts are overridable from `llm_call_configs`: these limits must not
 * be switchable from an admin panel.
 */
export const NOTE_CREATE_CONTRACT = `

CREATING NOTES (non-negotiable):
- When the user asks you to save, capture, write or make a note, call create_note immediately in the same turn. Do not ask permission first, and do not paste the note body into the chat and wait.
- If the user names a folder, call list_note_folders FIRST and reuse their existing folder path verbatim, capitalisation included. Only use a new folder name when nothing close exists.
- Put the content in the note, not in your reply. After creating, say in one line what you saved and which folder it went to. Never repeat the note body back.
- Create exactly what was asked for: one note unless the user asked for several.
- You can ONLY create. You cannot edit, move, rename or delete an existing note from here. If the user asks for that, say so plainly and tell them to open the note, where you can edit it with them.
- If a tool result says duplicate_call or limit_reached, the work is done or capped. Do not retry it in another form.`;

/**
 * Normalize a folder path the way `public.note_folder_normalize_path` does
 * (strip leading and trailing slashes, collapse repeats, trim), plus trim each
 * segment individually so " DeepSeek / Models " becomes "DeepSeek/Models".
 * Backslashes count as separators because users paste Windows-shaped paths.
 */
export function normalizeFolderPath(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw
    .replace(/\\/g, "/")
    .split("/")
    .map((seg) => seg.trim())
    .filter(Boolean)
    .join("/");
}

/**
 * Every folder path the user already has, from the folder table and from the
 * folders that notes actually sit in. A note can carry a `folder_path` with no
 * matching `note_folders` row, and the UI derives its tree from both.
 */
export async function loadExistingFolderPaths(
  db: any,
  userId: string,
): Promise<string[]> {
  const [folderRes, noteRes] = await Promise.all([
    db.from("note_folders").select("path").eq("user_id", userId).limit(2000),
    db
      .from("notes")
      .select("folder_path")
      .eq("user_id", userId)
      .eq("is_trashed", false)
      .neq("folder_path", "")
      .limit(5000),
  ]);

  const paths = new Set<string>();
  for (const r of (folderRes.data || []) as { path: string }[]) {
    const p = normalizeFolderPath(r.path);
    if (p) paths.add(p);
  }
  for (const r of (noteRes.data || []) as { folder_path: string }[]) {
    const p = normalizeFolderPath(r.folder_path);
    if (!p) continue;
    // A note in "A/B/C" implies "A" and "A/B" exist as folders too.
    const segs = p.split("/");
    for (let i = 1; i <= segs.length; i++) paths.add(segs.slice(0, i).join("/"));
  }
  return [...paths].sort();
}

/**
 * Map a requested path onto the casing the user already uses, segment by
 * segment. "deepseek/models" with an existing "DeepSeek" resolves to
 * "DeepSeek/models": the known segment keeps its casing, the new one keeps
 * whatever the caller asked for.
 */
export function matchFolderCasing(
  requested: string,
  existing: string[],
): string {
  if (!requested) return "";
  const byLower = new Map(existing.map((p) => [p.toLowerCase(), p]));

  const out: string[] = [];
  for (const seg of requested.split("/")) {
    const candidate = [...out, seg].join("/");
    const hit = byLower.get(candidate.toLowerCase());
    // `hit` is the full known path; take only its last segment.
    out.push(hit ? hit.slice(hit.lastIndexOf("/") + 1) : seg);
  }
  return out.join("/");
}

/**
 * Resolve a requested folder to a real path and make sure a `note_folders` row
 * exists for every segment of it.
 *
 * NOTE: this inserts rows directly instead of calling the `create_note_folder`
 * RPC. That RPC is SECURITY DEFINER on `auth.uid()`, and the edge function runs
 * on the service-role client where `auth.uid()` is NULL, so calling it would
 * raise "Not authenticated".
 */
export async function resolveFolderPath(
  db: any,
  userId: string,
  requested: unknown,
): Promise<{ path: string; created: string[] }> {
  const normalized = normalizeFolderPath(requested);
  if (!normalized) return { path: "", created: [] };

  const existing = await loadExistingFolderPaths(db, userId);
  const path = matchFolderCasing(normalized, existing);

  const known = new Set(existing.map((p) => p.toLowerCase()));
  const segs = path.split("/");
  const missing: {
    user_id: string;
    path: string;
    name: string;
    parent_path: string;
  }[] = [];
  for (let i = 1; i <= segs.length; i++) {
    const acc = segs.slice(0, i).join("/");
    if (known.has(acc.toLowerCase())) continue;
    missing.push({
      user_id: userId,
      path: acc,
      name: segs[i - 1],
      parent_path: segs.slice(0, i - 1).join("/"),
    });
  }

  if (missing.length > 0) {
    // Ignore conflicts: a concurrent writer may have created the same row.
    const { error } = await db
      .from("note_folders")
      .upsert(missing, { onConflict: "user_id,path", ignoreDuplicates: true });
    if (error) {
      // The note itself still lands in the right folder_path, and the UI
      // derives the tree from notes too, so this is a degraded success.
      console.warn("note-create: folder row insert failed:", error.message);
      return { path, created: [] };
    }
  }

  return { path, created: missing.map((m) => m.path) };
}

function wordCount(s: string): number {
  const t = s.trim();
  return t ? t.split(/\s+/).length : 0;
}

export interface NoteCreateOptions {
  /**
   * Called after a note row is inserted, so the caller can kick off the
   * process-note pipeline (embeddings, metadata, connections). Injected rather
   * than done here so this module stays free of Deno APIs.
   */
  onCreated?: (noteId: string) => void;
  /** Where the note came from, recorded on the row. Default "ai-chat". */
  sourceApp?: string;
}

/**
 * Execute one create tool. Always returns a JSON string for the agent loop.
 */
export async function executeNoteCreateTool(
  db: any,
  userId: string,
  session: NoteCreateSession,
  name: string,
  args: Record<string, unknown>,
  opts: NoteCreateOptions = {},
): Promise<string> {
  if (name === "list_note_folders") {
    const folders = await loadExistingFolderPaths(db, userId);
    return JSON.stringify({
      folders,
      count: folders.length,
      note: folders.length
        ? "Reuse one of these paths verbatim when the user names a folder that matches one, capitalisation included."
        : "The user has no folders yet.",
    });
  }

  if (name !== "create_note") {
    return JSON.stringify({ error: `Unknown create tool: ${name}` });
  }

  // ---- Dedupe identical create calls inside one turn ---------------------
  const key = `create_note:${JSON.stringify(args)}`;
  const prior = session.seen.get(key);
  if (prior !== undefined) {
    return JSON.stringify({
      ...JSON.parse(prior),
      duplicate_call: true,
      message:
        "This exact note was already created in this turn, and was NOT created a second time. The work is done, so do not retry it.",
    });
  }

  // ---- Per-turn cap -----------------------------------------------------
  if (session.created.length >= MAX_NOTES_PER_TURN) {
    return JSON.stringify({
      error: "limit_reached",
      message: `Already created ${MAX_NOTES_PER_TURN} notes in this turn, which is the limit. Tell the user what you created and ask them before creating more.`,
    });
  }

  const rawTitle = String(args.title ?? "").trim();
  const content = String(args.content ?? "");
  if (!rawTitle && !content.trim()) {
    return JSON.stringify({
      error: "empty",
      message: "A note needs a title or content. Nothing was created.",
    });
  }
  if (content.length > MAX_CONTENT_CHARS) {
    return JSON.stringify({
      error: "too_large",
      message: `The content is ${content.length} characters, over the ${MAX_CONTENT_CHARS} limit for one note. Split it or shorten it.`,
    });
  }

  const title = (
    rawTitle ||
    content.trim().split("\n")[0] ||
    "Untitled"
  ).slice(0, MAX_TITLE_CHARS);

  const folder = await resolveFolderPath(db, userId, args.folder);

  const tags = Array.isArray(args.tags)
    ? (args.tags as unknown[])
        .map((t) => String(t).trim())
        .filter(Boolean)
        .slice(0, 20)
    : [];

  const { data: inserted, error } = await db
    .from("notes")
    .insert({
      user_id: userId,
      title,
      content,
      tags,
      folder_path: folder.path,
      source_app: opts.sourceApp ?? "ai-chat",
      source_id: `ai-chat#${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
      metadata: {
        source: opts.sourceApp ?? "ai-chat",
        created_by: "assistant",
        created_at: new Date().toISOString(),
      },
    })
    .select("id, title, folder_path")
    .single();

  if (error || !inserted) {
    return JSON.stringify({
      error: "insert_failed",
      message: error?.message || "The note could not be created.",
    });
  }

  for (const p of folder.created) {
    if (!session.foldersCreated.includes(p)) session.foldersCreated.push(p);
  }
  session.created.push({
    id: inserted.id,
    title: inserted.title,
    folder_path: inserted.folder_path ?? "",
  });

  try {
    opts.onCreated?.(inserted.id);
  } catch (e) {
    console.warn("note-create: onCreated hook failed:", (e as Error).message);
  }

  // Receipt only. The body never goes back into the model's context.
  const result = {
    success: true,
    action: "create_note",
    note_id: inserted.id,
    title: inserted.title,
    folder_path: inserted.folder_path ?? "",
    folder_created: folder.created.length > 0,
    word_count: wordCount(content),
    message:
      "The note now exists and the user can see it. Do not repeat its content in your reply, just say what you saved and where.",
  };
  session.seen.set(key, JSON.stringify(result));
  return JSON.stringify(result);
}
