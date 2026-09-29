import { describe, expect, it } from "vitest";
import { estimateTokens, smartChunkMarkdown } from "../chunking.ts";

describe("smartChunkMarkdown", () => {
  it("hard-splits a span with no paragraph or sentence boundary", () => {
    // A base64 data URI or a minified blob has neither. It used to stay one
    // chunk, exceed the embedding provider's input limit, and fail the job.
    const blob = "A".repeat(20_000);
    const chunks = smartChunkMarkdown(`# Blob\n\n${blob}`, { maxTokens: 1200 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(estimateTokens(c.content)).toBeLessThanOrEqual(1200);
    expect(chunks.map((c) => c.content.replace(/^# Blob\s*/, "")).join("")).toContain(blob.slice(0, 4000));
  });

  it("never splits a surrogate pair when hard-splitting", () => {
    const emoji = "ab😀".repeat(4_000);
    const chunks = smartChunkMarkdown(emoji, { maxTokens: 500 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.content).not.toMatch(/[\uD800-\uDBFF]$/);
      expect(c.content).not.toMatch(/^[\uDC00-\uDFFF]/);
    }
  });

  it.each([
    ["Chinese", "今天和我的朋友王伟一起吃了午饭，我们聊了很多关于工作和家庭的事情。"],
    ["Russian", "Сегодня я обедал с моим другом Иваном, мы говорили о работе."],
    ["Greek", "Σήμερα έφαγα μεσημεριανό με τον φίλο μου τον Γιώργο."],
  ])("keeps a note written in %s (the trivial-content filter was ASCII-only)", (_script, text) => {
    const chunks = smartChunkMarkdown(text);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe(text);
  });

  it("still drops a chunk with no real content", () => {
    expect(smartChunkMarkdown("--- *** ...\n\n- [ ] ,")).toEqual([]);
  });
});
