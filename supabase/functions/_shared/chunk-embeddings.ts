// Helper to chunk a note, embed each chunk, and persist into note_chunks.
// Used by process-note (live capture) and backfill-embeddings (catch-up).

import { smartChunkMarkdown, buildEmbeddingInput, type NoteChunk } from "./chunking.ts";
import { getEmbeddingWithCredits } from "./llm-credits.ts";
import { sha256Hex } from "./sha256.ts";

const MAX_CHUNKS_PER_NOTE = 50;

/**
 * A pgvector column comes back from PostgREST as a string ("[0.1,0.2,...]"),
 * not an array. Both callers write the result into a vector column too, but
 * `firstChunkEmbedding` is typed `number[]` and is compared against elsewhere,
 * so normalise on the way in rather than leaking the wire format.
 *
 * Returns null on anything that does not parse, which simply forces a re-embed.
 */
function toVector(raw: unknown): number[] | null {
  if (Array.isArray(raw)) {
    return raw.every((n) => typeof n === "number" && Number.isFinite(n))
      ? (raw as number[])
      : null;
  }
  if (typeof raw !== "string" || raw.length === 0) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    return parsed.every((n) => typeof n === "number" && Number.isFinite(n))
      ? (parsed as number[])
      : null;
  } catch {
    return null;
  }
}

export interface ChunkEmbedResult {
  /** Rows actually written to note_chunks. Zero when nothing was replaced. */
  chunkCount: number;
  /**
   * Chunks actually SENT to the provider, whether or not they succeeded.
   * Excludes chunks whose vector was reused unchanged, so this is the figure
   * that tracks spend.
   */
  attempted: number;
  /** Chunks whose embedding input was unchanged, so no call was made for them. */
  reused?: number;
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
  let reused = 0;
  let remainingCredits: number | null = null;
  let insufficientCredits = false;
  let balanceUnavailable = false;
  const embedded: Array<{ chunk: NoteChunk; embedding: number[]; hash: string }> = [];

  // Vectors this note already has, keyed by the exact string that produced them.
  //
  // Read BEFORE the delete below, which is the whole trick: the delete-then-
  // reinsert shape means the old vectors are gone by the time they could be
  // reused, so they have to be in memory first. A chunk whose embedding input is
  // unchanged does not need to be embedded again, and editing one paragraph of a
  // 50-chunk note used to pay for all 50.
  const priorByHash = new Map<string, number[]>();
  try {
    const { data: priorRows } = await admin
      .from("note_chunks")
      .select("content_hash, embedding")
      .eq("note_id", noteId)
      .not("content_hash", "is", null);
    for (const row of priorRows || []) {
      const vec = toVector(row.embedding);
      if (row.content_hash && vec) priorByHash.set(row.content_hash as string, vec);
    }
  } catch (err) {
    // Cache miss is always safe: every chunk is simply embedded as before.
    console.warn("note_chunks prior-hash lookup failed", noteId, (err as Error).message);
  }

  for (const chunk of limited) {
    const input = buildEmbeddingInput(noteTitle, chunk);
    const hash = await sha256Hex(input);

    const cached = priorByHash.get(hash);
    if (cached) {
      reused += 1;
      embedded.push({ chunk, embedding: cached, hash });
      continue;
    }

    attempted += 1;
    try {
      const { embedding, credits } = await getEmbeddingWithCredits(
        admin, openrouterApiKey, userId, feature, input,
      );
      remainingCredits = credits?.remaining_credits ?? remainingCredits;
      embedded.push({ chunk, embedding, hash });
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
      reused,
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

  if (reused > 0) {
    console.log(
      `note_chunks ${noteId}: ${reused}/${limited.length} chunks unchanged, ` +
        `${attempted} embedded.`,
    );
  }

  await admin.from("note_chunks").delete().eq("note_id", noteId);
  let inserted = 0;
  let writeFailures = 0;
  for (const { chunk, embedding, hash } of embedded) {
    const { error } = await admin.from("note_chunks").insert({
      note_id: noteId,
      user_id: userId,
      chunk_index: chunk.index,
      heading_path: chunk.headingPath || null,
      content: chunk.content,
      token_count: chunk.tokenCount,
      embedding,
      content_hash: hash,
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
    reused,
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
