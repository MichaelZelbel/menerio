import { describe, expect, it, vi, beforeEach } from "vitest";

const getEmbedding = vi.fn();
vi.mock("../llm-credits.ts", () => ({
  getEmbeddingWithCredits: (...a: unknown[]) => getEmbedding(...a),
}));

import { embedAndStoreNoteChunks } from "../chunk-embeddings.ts";

const del = vi.fn();
const insert = vi.fn();

/**
 * `priorRows` stands in for the note's existing note_chunks rows, which
 * `embedAndStoreNoteChunks` reads before it deletes anything so an unchanged
 * chunk can reuse its vector instead of paying to embed it again.
 */
function fakeAdmin(priorRows: Array<{ content_hash: string; embedding: unknown }> = []) {
  return {
    from: () => ({
      delete: () => ({ eq: del }),
      insert,
      select: () => ({
        eq: () => ({ not: () => Promise.resolve({ data: priorRows, error: null }) }),
      }),
    }),
  };
}

// Long enough to produce several chunks through smartChunkMarkdown.
const LONG = Array.from(
  { length: 40 },
  (_, i) => `## Heading ${i}\n\n${`Body sentence ${i} with enough words to matter. `.repeat(20)}`,
).join("\n\n");

beforeEach(() => {
  del.mockReset().mockResolvedValue({ error: null });
  insert.mockReset().mockResolvedValue({ error: null });
  getEmbedding.mockReset();
});

describe("embedAndStoreNoteChunks", () => {
  it("keeps the existing chunks when embedding stops part-way", async () => {
    getEmbedding
      .mockResolvedValueOnce({ embedding: [0.1], credits: { remaining_credits: 5 } })
      .mockRejectedValue(new Error("INSUFFICIENT_CREDITS"));

    const res = await embedAndStoreNoteChunks(fakeAdmin(), "k", "u1", "n1", "T", LONG, "f");

    // A partial set is not a replacement: the note keeps whatever it had.
    expect(del).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
    expect(res.replaced).toBe(false);
    expect(res.insufficientCredits).toBe(true);
  });

  it("reports chunks actually written, not chunks planned", async () => {
    getEmbedding
      .mockResolvedValueOnce({ embedding: [0.1], credits: { remaining_credits: 5 } })
      .mockRejectedValue(new Error("INSUFFICIENT_CREDITS"));

    const res = await embedAndStoreNoteChunks(fakeAdmin(), "k", "u1", "n1", "T", LONG, "f");

    expect(res.chunkCount).toBe(0);
    expect(res.attempted).toBeGreaterThan(1);
  });

  it("replaces the whole set when every chunk embeds", async () => {
    getEmbedding.mockResolvedValue({ embedding: [0.1], credits: { remaining_credits: 5 } });

    const res = await embedAndStoreNoteChunks(fakeAdmin(), "k", "u1", "n1", "T", LONG, "f");

    expect(res.replaced).toBe(true);
    expect(res.failures).toBe(0);
    expect(res.chunkCount).toBe(insert.mock.calls.length);
    expect(res.chunkCount).toBeGreaterThan(0);
    // Deleted exactly once, and only after every embedding succeeded.
    expect(del).toHaveBeenCalledTimes(1);
  });

  it("stops on an unreadable allowance and says so", async () => {
    getEmbedding.mockRejectedValue(new Error("BALANCE_UNAVAILABLE"));

    const res = await embedAndStoreNoteChunks(fakeAdmin(), "k", "u1", "n1", "T", LONG, "f");

    expect(res.balanceUnavailable).toBe(true);
    expect(res.insufficientCredits).toBe(false);
    expect(res.replaced).toBe(false);
    expect(del).not.toHaveBeenCalled();
  });

  it("clears the chunks when the note genuinely has none", async () => {
    const res = await embedAndStoreNoteChunks(fakeAdmin(), "k", "u1", "n1", "T", "", "f");
    expect(res.chunkCount).toBe(0);
    expect(del).toHaveBeenCalledTimes(1);
  });
});

// Re-embedding a chunk that did not change is money for nothing. Before
// 2026-09-03 a one-word edit to a 50-chunk note paid for all 50 embeddings.
describe("embedAndStoreNoteChunks — reusing unchanged vectors", () => {
  it("embeds every chunk when the note has no stored hashes", async () => {
    getEmbedding.mockResolvedValue({ embedding: [0.1], credits: { remaining_credits: 5 } });

    const res = await embedAndStoreNoteChunks(fakeAdmin([]), "k", "u1", "n1", "T", LONG, "f");

    expect(res.reused).toBe(0);
    expect(res.attempted).toBe(res.chunkCount);
    expect(getEmbedding).toHaveBeenCalledTimes(res.chunkCount);
  });

  it("makes no provider call at all when every chunk is unchanged", async () => {
    // First pass: learn the hashes this note produces.
    getEmbedding.mockResolvedValue({ embedding: [0.1], credits: { remaining_credits: 5 } });
    await embedAndStoreNoteChunks(fakeAdmin([]), "k", "u1", "n1", "T", LONG, "f");
    const hashes = insert.mock.calls.map((c) => (c[0] as { content_hash: string }).content_hash);
    expect(hashes.length).toBeGreaterThan(1);
    expect(hashes.every((h) => typeof h === "string" && h.length === 64)).toBe(true);

    // Second pass: the same note, with those hashes already stored.
    const prior = hashes.map((h) => ({ content_hash: h, embedding: "[0.1]" }));
    insert.mockClear();
    getEmbedding.mockClear();

    const res = await embedAndStoreNoteChunks(fakeAdmin(prior), "k", "u1", "n1", "T", LONG, "f");

    expect(getEmbedding).not.toHaveBeenCalled();
    expect(res.attempted).toBe(0);
    expect(res.reused).toBe(hashes.length);
    // The chunks are still all written, so search is unchanged.
    expect(res.replaced).toBe(true);
    expect(res.chunkCount).toBe(hashes.length);
    expect(res.firstChunkEmbedding).toEqual([0.1]);
  });

  it("embeds only the chunks whose text moved", async () => {
    getEmbedding.mockResolvedValue({ embedding: [0.2], credits: { remaining_credits: 5 } });
    await embedAndStoreNoteChunks(fakeAdmin([]), "k", "u1", "n1", "T", LONG, "f");
    const hashes = insert.mock.calls.map((c) => (c[0] as { content_hash: string }).content_hash);

    // Drop one stored hash: exactly one chunk now looks new.
    const prior = hashes.slice(1).map((h) => ({ content_hash: h, embedding: "[0.2]" }));
    getEmbedding.mockClear();
    insert.mockClear();

    const res = await embedAndStoreNoteChunks(fakeAdmin(prior), "k", "u1", "n1", "T", LONG, "f");

    expect(getEmbedding).toHaveBeenCalledTimes(1);
    expect(res.attempted).toBe(1);
    expect(res.reused).toBe(hashes.length - 1);
    expect(res.chunkCount).toBe(hashes.length);
  });

  it("re-embeds rather than trusting a vector it cannot parse", async () => {
    getEmbedding.mockResolvedValue({ embedding: [0.3], credits: { remaining_credits: 5 } });
    await embedAndStoreNoteChunks(fakeAdmin([]), "k", "u1", "n1", "T", LONG, "f");
    const hashes = insert.mock.calls.map((c) => (c[0] as { content_hash: string }).content_hash);

    const junk = hashes.map((h) => ({ content_hash: h, embedding: "not-a-vector" }));
    getEmbedding.mockClear();

    const res = await embedAndStoreNoteChunks(fakeAdmin(junk), "k", "u1", "n1", "T", LONG, "f");

    expect(res.reused).toBe(0);
    expect(getEmbedding).toHaveBeenCalledTimes(hashes.length);
  });
});
