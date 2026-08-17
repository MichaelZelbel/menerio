import { describe, expect, it, vi, beforeEach } from "vitest";

const getEmbedding = vi.fn();
vi.mock("../llm-credits.ts", () => ({
  getEmbeddingWithCredits: (...a: unknown[]) => getEmbedding(...a),
}));

import { embedAndStoreNoteChunks } from "../chunk-embeddings.ts";

const del = vi.fn();
const insert = vi.fn();

function fakeAdmin() {
  return { from: () => ({ delete: () => ({ eq: del }), insert }) };
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
