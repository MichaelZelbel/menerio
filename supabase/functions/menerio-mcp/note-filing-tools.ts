import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { normalizeFolderPath, resolveFolderPath } from "../_shared/note-create-tools.ts";
import { HUB_FOLDER_ROOT, isHubFolderPath } from "../_shared/hub-ranking.ts";
import { buildFolderListing, captureTitle, findRelatedNotes, formatCaptureReceipt, mergeTags, type IndexingState, type RelatedNote } from "../_shared/note-filing.ts";
import { syncWikilinkConnections } from "../_shared/wikilinks.ts";
import { selectAllRows } from "../_shared/paged-select.ts";
import type { ChunkEmbedResult } from "../_shared/chunk-embeddings.ts";
import type { DbClient } from "../_shared/db-client.ts";

/**
 * capture_note and list_note_folders: how an assistant files a note properly.
 *
 * Lives beside index.ts, like contact-topics-tools.ts, so the tools can be run
 * through the MCP SDK's own transport in a Node test. Everything that needs the
 * edge runtime (the model call, the embedding call, the process-note trigger)
 * is handed in as `deps`; the database client and the user are handed in the
 * same way index.ts hands them to the topic tools.
 *
 * Scopes are NOT declared here. Both tools are gated by their entries in
 * TOOL_SCOPES in index.ts, which refuses to start with a tool it cannot gate.
 */
export interface NoteFilingDeps {
  /** AI metadata for the body (type, topics, people, action items). Never throws. */
  extractMetadata: (content: string) => Promise<Record<string, unknown>>;
  /** Chunk, embed and store. Metered against the user by the implementation. */
  embedChunks: (noteId: string, title: string, content: string) => Promise<ChunkEmbedResult>;
  /** Fire-and-forget start of the process-note pipeline. */
  triggerProcessNote: (noteId: string) => void;
}

const text = (t: string, isError = false) => ({
  content: [{ type: "text" as const, text: t }],
  ...(isError ? { isError: true } : {}),
});

export const HUB_FOLDER_REFUSAL =
  `The "${HUB_FOLDER_ROOT}" folder tree is a mirror of the user's hub files and is rewritten by the sync, so notes cannot be filed in or under it. ` +
  `Nothing was saved. Call list_note_folders and pick one of the user's own folders, or omit folder_path for the top level.`;

export type CaptureNoteArgs = {
  content: string;
  title?: string;
  folder_path?: string;
  tags?: string[];
};

export function registerNoteFilingTools(
  server: McpServer,
  db: DbClient,
  userId: () => string,
  deps: NoteFilingDeps,
) {
  const captureNoteHandler = async ({ content, title, folder_path, tags }: CaptureNoteArgs) => {
    try {
      const owner = userId();

      // Refuse the mirror's tree BEFORE anything is spent or written. Same
      // normalisation as update_note and the Hub API, so "/Hub/rules/" cannot
      // slip past as a different spelling of the same place.
      const requestedFolder = normalizeFolderPath(folder_path);
      if (isHubFolderPath(requestedFolder)) return text(HUB_FOLDER_REFUSAL, true);

      const metadata = await deps.extractMetadata(content);
      const finalTitle = captureTitle(content, title);
      const finalTags = mergeTags(tags, (metadata as { topics?: unknown }).topics);

      // Reuses the casing of a folder the user already has and makes the
      // note_folders rows for a new one. Rows are inserted directly: the
      // create_note_folder RPC reads auth.uid(), which is NULL for this client.
      const folder = await resolveFolderPath(db, owner, requestedFolder);

      const { data: inserted, error } = await db.from("notes").insert({
        user_id: owner,
        content,
        title: finalTitle,
        metadata: { ...metadata, source: "mcp" },
        tags: finalTags,
        folder_path: folder.path,
      }).select("id, title, folder_path").single();

      if (error || !inserted) {
        return text(`Failed to capture: ${error?.message || "insert failed"}`, true);
      }

      // Build chunks + embeddings synchronously so the note is searchable immediately.
      let indexing: IndexingState = "pending";
      let related: RelatedNote[] = [];
      try {
        const res = await deps.embedChunks(inserted.id, finalTitle, content);
        if (res.firstChunkEmbedding) {
          await db.from("notes").update({ embedding: res.firstChunkEmbedding }).eq("id", inserted.id);
          indexing = "indexed";
          // The vector that was just paid for answers "what is this close to"
          // for free, so the assistant can mention or link the neighbours.
          try {
            related = await findRelatedNotes(db, owner, res.firstChunkEmbedding, inserted.id);
          } catch (relErr) {
            console.warn("related-notes lookup failed on capture", (relErr as Error).message);
          }
        } else if (res.insufficientCredits) {
          indexing = "deferred_no_credits";
        } else if (res.failures > 0 && res.chunkCount === 0) {
          indexing = "failed";
        } else if (res.replaced && res.chunkCount === 0) {
          // Nothing to embed (an empty body): indexed, with nothing to relate.
          indexing = "indexed";
        }
      } catch (idxErr) {
        console.warn("chunk indexing failed on capture", (idxErr as Error).message);
      }

      // [[Exact Title]] in the body becomes a manual_link row now. The editor
      // does this on save and process-note does not, so without it an
      // assistant's explicit links would stay plain text.
      let wikilinks = { linked: [] as { title: string; note_id: string }[], unresolved: [] as string[] };
      try {
        const res = await syncWikilinkConnections(db, owner, inserted.id, content);
        wikilinks = { linked: res.linked, unresolved: res.unresolved };
      } catch (linkErr) {
        console.warn("wikilink sync failed on capture", (linkErr as Error).message);
      }

      // Fire-and-forget: trigger full process-note pipeline (metadata, profile facts,
      // moments, relationships, connections). Mirrors receive-note / hub-api-notes.
      try { deps.triggerProcessNote(inserted.id); }
      catch (e) { console.warn("process-note trigger failed (capture):", (e as Error).message); }

      return text(formatCaptureReceipt({
        noteId: inserted.id,
        title: inserted.title ?? finalTitle,
        folderPath: inserted.folder_path ?? folder.path,
        foldersCreated: folder.created,
        tags: finalTags,
        metadata,
        indexing,
        related,
        wikilinks,
      }));
    } catch (err: unknown) {
      return text(`Error: ${(err as Error).message}`, true);
    }
  };

  server.registerTool(
    "capture_note",
    {
      title: "Capture Note",
      description:
        "Save a new note to the user's brain, filed properly. Generates an embedding and extracts metadata automatically. " +
        "Pass `title` for a clear, specific title (otherwise the first line of the content is used). " +
        "Pass `folder_path` to file it: call `list_note_folders` first and reuse one of the user's existing folders verbatim when one fits (e.g. 'Health' or 'Projects/Menerio'); a path that does not exist yet is created; omit it for the top level. The `hub` folder tree is a read-only mirror and is refused. " +
        "Pass `tags` to add the user's own tags; they are merged with the AI-extracted topics. " +
        "To link this note to another on purpose, write `[[Exact Title]]` of an existing note in the content: it becomes a real link in the graph and backlinks. " +
        "The response states the note id, final title, folder, and up to 5 most related existing notes (title + id) you can mention or wikilink. Menerio also links related notes on its own in the background, so you do not need to link everything by hand.",
      inputSchema: {
        content: z.string().describe("The note content to capture (Markdown). `[[Exact Title]]` links to an existing note."),
        title: z.string().optional().describe("Title for the note. Defaults to the first line of the content."),
        folder_path: z.string().optional().describe("Folder to file the note in, e.g. 'Health' or 'Projects/Menerio'. See list_note_folders. Omit for the top level. Anything under 'hub' is refused."),
        tags: z.array(z.string()).optional().describe("Tags to add; merged with the AI-extracted topics."),
      },
    },
    captureNoteHandler,
  );

  server.registerTool(
    "capture_thought",
    {
      title: "Capture Thought (deprecated alias)",
      description: "Deprecated alias for `capture_note`. Use `capture_note` instead.",
      inputSchema: { content: z.string() },
    },
    captureNoteHandler,
  );

  server.registerTool(
    "list_note_folders",
    {
      title: "List Note Folders",
      description:
        "List the user's note folders with how many notes each holds, sorted by path, plus the count of notes at the top level. " +
        "Call this BEFORE `capture_note` or before moving a note with `update_note`, and pick the folder that fits, reusing its path verbatim, capitalisation included. " +
        "The `hub` tree (a machine-maintained mirror of the user's hub files, where nothing can be filed) is hidden unless `include_hub` is true.",
      inputSchema: {
        include_hub: z.boolean().optional().default(false).describe("Also list the read-only `hub` mirror tree. Default false."),
      },
    },
    async ({ include_hub }: { include_hub?: boolean }) => {
      try {
        const owner = userId();
        const includeHub = include_hub === true;

        // Paged: the mirror alone is thousands of notes, and an unpaged select
        // stops at PostgREST's 1000-row cap without saying so, which would make
        // the counts quietly wrong. The mirror is filtered out in the query
        // when it is not wanted, so the usual call reads only the user's notes.
        const noteRows = await selectAllRows<{ folder_path: string | null }>((from, to) => {
          let q = db.from("notes")
            .select("folder_path")
            .eq("user_id", owner)
            .eq("is_trashed", false)
            .eq("ai_visibility", "visible");
          if (!includeHub) {
            q = q.not("folder_path", "ilike", HUB_FOLDER_ROOT).not("folder_path", "ilike", `${HUB_FOLDER_ROOT}/%`);
          }
          return q.order("id").range(from, to);
        });
        const folderRows = await selectAllRows<{ path: string | null }>((from, to) =>
          db.from("note_folders").select("path").eq("user_id", owner).order("path").range(from, to));

        const listing = buildFolderListing(
          folderRows.map((r) => r.path),
          noteRows.map((r) => r.folder_path),
          includeHub,
        );
        return text(JSON.stringify({
          ...listing,
          note: listing.folder_count
            ? "Reuse one of these paths verbatim as folder_path when it fits. A new path is created on capture. Nothing can be filed under 'hub'."
            : "The user has no folders yet. A folder_path passed to capture_note is created.",
        }, null, 2));
      } catch (err: unknown) {
        return text(`Error: ${(err as Error).message}`, true);
      }
    },
  );

  return { captureNoteHandler };
}
