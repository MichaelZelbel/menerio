// Helper to chunk a note, embed each chunk, and persist into note_chunks.
// Used by process-note (live capture) and backfill-embeddings (catch-up).

import { smartChunkMarkdown, buildEmbeddingInput, type NoteChunk } from "./chunking.ts";
import { getEmbeddingWithCredits } from "./llm-credits.ts";

const MAX_CHUNKS_PER_NOTE = 50;

export interface ChunkEmbedResult {
  /** Rows actually written to note_chunks. Zero when nothing was replaced. */
  chunkCount: number;
  /** Chunks we tried to embed, whether or not they succeeded. */
  attempted: number;
  /** True only when the note's chunks were swapped for a complete new set. */
  replaced: boolean;
  truncated: boolean;
  failures: number;
  firstChunkEmbedding: number[] | null;
  remainingCredits?: number | null;
  insufficientCredits?: boolean;
  /** The allowance could not be read at all. Distinct from a spent quota. */
  balanceUnavailable?: boolean;
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

  if (limited.length === 0) {
    // The note really has no chunks now, so clearing them is the correct result.
    await admin.from("note_chunks").delete().eq("note_id", noteId);
    return {
      chunkCount: 0, attempted: 0, replaced: true,
      truncated: false, failures: 0, firstChunkEmbedding: null,
    };
  }

  // Embed EVERY chunk before touching the database.
  //
  // The previous version deleted the old chunks as soon as the FIRST embedding
  // succeeded, then inserted the rest one at a time. Deferring the delete that
  // far protected only the total-failure case: if chunk 0 succeeded and chunk 1
  // ran out of credits, the old chunks were already gone and the note was left
  // holding one, so search quietly stopped finding most of it. Buffering first
  // means a partial run changes nothing at all, which is what "keep the stale
  // chunks until a real replacement exists" actually requires. Fifty chunks of
  // embedding floats is well under a megabyte.
  let failures = 0;
  let attempted = 0;
  let remainingCredits: number | null = null;
  let insufficientCredits = false;
  let balanceUnavailable = false;
  const embedded: Array<{ chunk: NoteChunk; embedding: number[] }> = [];

  for (const chunk of limited) {
    attempted += 1;
    const input = buildEmbeddingInput(noteTitle, chunk);
    try {
      const { embedding, credits } = await getEmbeddingWithCredits(
        admin, openrouterApiKey, userId, feature, input,
      );
      remainingCredits = credits?.remaining_credits ?? remainingCredits;
      embedded.push({ chunk, embedding });
    } catch (err) {
      const msg = (err as Error).message || String(err);
      console.warn("chunk embedding failed", noteId, chunk.index, msg);
      failures += 1;
      if (msg === "BALANCE_UNAVAILABLE") {
        // Not a spent quota: the allowance could not be read. Stop for the same
        // reason (no point embedding the rest), but report it as the different
        // thing it is, so a retry is obviously worth attempting.
        balanceUnavailable = true;
        break;
      }
      if (msg === "INSUFFICIENT_CREDITS" || msg.toLowerCase().includes("insufficient")) {
        insufficientCredits = true;
        break;
      }
    }
  }

  // A partial set is not a replacement. Leave the note's existing chunks alone
  // and report zero, so the caller retries instead of believing it indexed.
  //
  // firstChunkEmbedding is deliberately null here too. All three callers write
  // it to notes.embedding, and process-note's idempotency check treats "has an
  // embedding" as part of "already processed" — so handing back a vector from a
  // run that stored no chunks would mark the note done and make the retry never
  // come. Nothing about the note changes on a partial run, that column included.
  if (embedded.length !== limited.length) {
    console.warn(
      `note_chunks NOT replaced for ${noteId}: embedded ${embedded.length}/${limited.length}`,
    );
    return {
      chunkCount: 0,
      attempted,
      replaced: false,
      truncated,
      failures,
      firstChunkEmbedding: null,
      remainingCredits,
      insufficientCredits,
      balanceUnavailable,
    };
  }

  const firstChunkEmbedding =
    embedded.find((e) => e.chunk.index === 0)?.embedding ?? null;

  await admin.from("note_chunks").delete().eq("note_id", noteId);
  let inserted = 0;
  let writeFailures = 0;
  for (const { chunk, embedding } of embedded) {
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
      writeFailures += 1;
    } else {
      inserted += 1;
    }
  }

  return {
    // Rows written, counted as they were written. This used to be
    // `limited.length - failures`, computed from the whole plan even when the
    // loop broke early, so a run that stored nothing could report 39 chunks.
    chunkCount: inserted,
    attempted,
    replaced: true,
    truncated,
    failures: failures + writeFailures,
    firstChunkEmbedding,
    remainingCredits,
    insufficientCredits,
    balanceUnavailable,
  };
}

export { MAX_CHUNKS_PER_NOTE };
