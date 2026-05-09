// Helper to chunk a note, embed each chunk, and persist into note_chunks.
// Used by process-note (live capture) and backfill-embeddings (catch-up).

import { smartChunkMarkdown, buildEmbeddingInput, type NoteChunk } from "./chunking.ts";
import { getEmbeddingWithCredits } from "./llm-credits.ts";

const MAX_CHUNKS_PER_NOTE = 50;

export interface ChunkEmbedResult {
  chunkCount: number;
  truncated: boolean;
  failures: number;
  firstChunkEmbedding: number[] | null;
  remainingCredits?: number | null;
  insufficientCredits?: boolean;
}

export async function embedAndStoreNoteChunks(
  admin: any,
  openrouterApiKey: string,
  userId: string,
  noteId: string,
  noteTitle: string | null,
  fullText: string,
  feature: string,
): Promise<ChunkEmbedResult> {
  const chunks = smartChunkMarkdown(fullText);
  const truncated = chunks.length > MAX_CHUNKS_PER_NOTE;
  const limited = truncated ? chunks.slice(0, MAX_CHUNKS_PER_NOTE) : chunks;

  // Replace any existing chunks for this note.
  await admin.from("note_chunks").delete().eq("note_id", noteId);

  if (limited.length === 0) {
    return { chunkCount: 0, truncated: false, failures: 0, firstChunkEmbedding: null };
  }

  let failures = 0;
  let firstChunkEmbedding: number[] | null = null;
  let remainingCredits: number | null = null;
  let insufficientCredits = false;

  for (const chunk of limited) {
    const input = buildEmbeddingInput(noteTitle, chunk);
    try {
      const { embedding, credits } = await getEmbeddingWithCredits(
        admin, openrouterApiKey, userId, feature, input,
      );
      remainingCredits = credits?.remaining_credits ?? remainingCredits;
      if (chunk.index === 0) firstChunkEmbedding = embedding;

      const { error } = await admin.from("note_chunks").insert({
        note_id: noteId,
        user_id: userId,
        chunk_index: chunk.index,
        heading_path: chunk.headingPath || null,
        content: chunk.content,
        token_count: chunk.tokenCount,
        embedding,
      });
      if (error) {
        console.warn("note_chunks insert error", noteId, chunk.index, error.message);
        failures += 1;
      }
    } catch (err) {
      const msg = (err as Error).message || String(err);
      console.warn("chunk embedding failed", noteId, chunk.index, msg);
      failures += 1;
      if (msg === "INSUFFICIENT_CREDITS" || msg.toLowerCase().includes("insufficient")) {
        insufficientCredits = true;
        break;
      }
    }
  }

  return {
    chunkCount: limited.length - failures,
    truncated,
    failures,
    firstChunkEmbedding,
    remainingCredits,
    insufficientCredits,
  };
}

export { MAX_CHUNKS_PER_NOTE };
